import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, buildVariant } from '../js/cc/compile.js';
import { optimize, CLASSIC, perforableLoops, outputError } from '../js/cc/opt.js';
import { interpret } from '../js/cc/irinterp.js';
import { runAsm } from '../js/cc/run.js';
import { EXAMPLES } from '../js/examples.js';

const ex = (id) => compile(EXAMPLES.find((e) => e.id === id).code);
const run = (c, mod) => {
    const v = buildVariant(c, mod);
    const a = runAsm({ ...c, module: mod, asm: v.asm });
    assert.equal(a.errors.length, 0);
    return { ir: interpret(mod), asm: a, v };
};

test('passes clássicos: o que cada um faz', () => {
    const c = compile(`int main() { int a = 2 * 3; int b = a + 0; int x = 7; if (a > 5) x = b * 8; else x = 1; return x; }`);
    const { module, log } = optimize(c.ssa.module, { classic: CLASSIC });
    const keys = new Set(log.map((l) => l.key));
    assert.ok(keys.has('opt.fold') && keys.has('opt.branch') && keys.has('opt.unreachable'));
    const F = module.functions[0];
    assert.equal(F.blocks.length, 1);
    assert.equal(F.blocks[0].insts.length, 1);
    assert.equal(interpret(module).ret, 48);
    const m = optimize(ex('matriz').ssa.module, { classic: ['licm', 'cse'] });
    assert.ok(m.log.some((l) => l.key === 'opt.licm' && l.p.h === 'for.cond3'));
    const s = optimize(compile('int main() { int v = 5; int r = 0; for (int i = 0; i < 4; i++) r = r + v * 4; return r; }').ssa.module, { classic: ['simplify'] });
    assert.ok(s.log.some((l) => l.key === 'opt.strength'));
});

test('perfuração de laço', () => {
    const c = ex('pi');
    const loops = perforableLoops(c.ssa.module);
    assert.equal(loops.length, 1);
    assert.equal(loops[0].name, 'k');
    const ref = interpret(c.module);
    for (const k of [1, 2, 3, 4]) {
        const { module } = optimize(c.ssa.module, { classic: CLASSIC, perforate: { fn: 'main', header: loops[0].header, k } });
        const r = run(c, module);
        assert.equal(r.asm.ret, r.ir.ret);
        const e = outputError(ref, r.ir);
        if (k === 1) assert.ok(e.same); else assert.ok(!e.same && e.finished);
        if (k > 1) assert.ok(r.ir.steps < ref.steps);
    }
    // Laço com saída por != não é perfurado (poderia não terminar).
    assert.equal(perforableLoops(compile('int main() { int s = 0; for (int i = 0; i != 10; i++) s += i; return s; }').ssa.module).length, 0);
});

test('redução de precisão do float e multiplicação aproximada', () => {
    const c = ex('filtro');
    const ref = interpret(c.module);
    let prev = 0;
    for (const bits of [23, 16, 10, 6, 2]) {
        const { module } = optimize(c.ssa.module, { classic: CLASSIC, fprec: bits });
        const r = run(c, module);
        assert.equal(r.asm.ret, r.ir.ret, `bits ${bits}`);
        const e = outputError(ref, r.ir);
        if (bits === 23) assert.ok(e.same);
        assert.ok(e.mre >= prev - 1e-12);
        prev = e.mre;
    }
    const d = ex('produto');
    const dref = interpret(d.module);
    for (const k of [0, 2, 4]) {
        const { module, log } = optimize(d.ssa.module, { classic: CLASSIC, amul: k });
        const r = run(d, module);
        assert.equal(r.asm.ret, r.ir.ret);
        if (k === 0) assert.equal(r.ir.ret, dref.ret); else assert.ok(log.some((l) => l.key === 'opt.amul'));
    }
    // A multiplicação que calcula endereços (A[i * n + k]) não é aproximada.
    const m = ex('matriz');
    const { module } = optimize(m.ssa.module, { amul: 8 });
    const r = run(m, module);
    assert.equal(r.asm.reason, 'end');
});

test('soma aproximada: truncamento e LOA como os somadores do axc', async () => {
    const { approxAddValue } = await import('../js/cc/opt.js');
    const vals = [1234, -567, 89, 4321, -2048, 77, 999, -3];
    const src = `int v[8] = {${vals.join(', ')}}; int d[8];
int main() { int s = 0; for (int i = 0; i < 8; i++) { s = s + v[i]; d[i] = s - v[7 - i]; } return s; }`;
    const c = compile(src);
    const ref = interpret(c.module);
    for (const kind of ['trunc', 'loa']) {
        for (const k of [0, 3, 6]) {
            const { module, log } = optimize(c.ssa.module, { classic: CLASSIC, aadd: { kind, k } });
            const r = run(c, module);
            assert.equal(r.asm.ret, r.ir.ret, `${kind} ${k}`);
            // Retorno e vetor d iguais ao modelo (na truncada, a subtração é (a & m) - (b & m)).
            let s2 = 0; const d2 = [];
            for (let i = 0; i < 8; i++) {
                s2 = approxAddValue(kind, k, s2, vals[i]);
                const y = vals[7 - i];
                d2.push(k === 0 ? (s2 - y) | 0 : kind === 'trunc' ? ((s2 & ~((1 << k) - 1)) - (y & ~((1 << k) - 1))) | 0 : approxAddValue('loa', k, s2, ~y));
            }
            assert.equal(r.ir.ret, s2, `${kind} ${k} ret`);
            assert.deepEqual(r.ir.globals.get('d'), d2, `${kind} ${k} d`);
            if (k === 0) assert.equal(r.ir.ret, ref.ret);
            else assert.ok(log.some((l) => l.key === `opt.aadd.${kind}`));
        }
    }
    // O incremento do laço (endereço e condição) não é aproximado: o programa termina.
    const { module } = optimize(ex('matriz').ssa.module, { aadd: { kind: 'loa', k: 8 } });
    assert.equal(run(ex('matriz'), module).asm.reason, 'end');
});

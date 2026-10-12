import { test } from 'node:test';
import assert from 'node:assert/strict';
import { both } from './helpers.js';
import { compile } from '../js/cc/compile.js';
import { runAsm } from '../js/cc/run.js';
import { EXAMPLES } from '../js/examples.js';

const many = (n, fl) => {
    const ty = fl ? 'float' : 'int';
    const vars = Array.from({ length: n }, (_, k) => `v${k}`);
    return `
${ty} f(${ty} x) { return x + 1; }
${ty} main() {
    ${vars.map((v, k) => `${ty} ${v} = ${k + 1};`).join('\n    ')}
    for (int i = 0; i < 3; i++) {
        ${vars.map((v, k) => `${v} = ${v} + ${vars[(k + 1) % n]} * 2;`).join('\n        ')}
        v0 = f(v0);
    }
    return ${vars.join(' + ')};
}`;
};

test('derramamento: mais valores vivos que registradores, com chamadas no meio', () => {
    for (const fl of [false, true]) {
        const src = many(fl ? 26 : 20, fl);
        both(src);
        const c = compile(src, { regalloc: true });
        const fr = c.ssa.frames.find((f) => f.fn === 'main');
        assert.ok(fr.regalloc.some((x) => x.spilled), 'algum valor derramado');
        assert.ok(fr.slots.some((s) => s.kind === 'saved'), 'registradores salvos pela função chamada');
    }
});

test('a alocação reduz as instruções executadas na forma SSA', () => {
    for (const id of ['fib', 'matriz', 'bubble']) {
        const src = EXAMPLES.find((e) => e.id === id).code;
        const s = compile(src), r = compile(src, { regalloc: true });
        const a = runAsm({ ...s, module: s.ssa.module, asm: s.ssa.asm }), b = runAsm({ ...r, module: r.ssa.module, asm: r.ssa.asm });
        assert.equal(a.ret, b.ret);
        assert.ok(b.executed < 0.8 * a.executed, `${id}: ${b.executed} contra ${a.executed}`);
    }
});

test('escalonamento para a emissão dupla forma mais pacotes cheios', async () => {
    const { simulateProfile } = await import('../js/cc/profile.js');
    for (const id of ['saxpy', 'filtro']) {
        const src = EXAMPLES.find((e) => e.id === id).code;
        const a = simulateProfile(compile(src).ssa.asm.text, { model: 'dual' });
        const b = simulateProfile(compile(src, { schedule: 'dual' }).ssa.asm.text, { model: 'dual' });
        assert.ok(b.cycles < a.cycles, `${id}: ${b.cycles} contra ${a.cycles}`);
        assert.ok(b.stats.dualPackets > a.stats.dualPackets);
    }
});

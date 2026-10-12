import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../js/cc/compile.js';
import { analyzeCfg } from '../js/cc/cfg.js';
import { blockDfg, defUse } from '../js/cc/dfg.js';
import { EXAMPLES } from '../js/examples.js';
import { cfgDot, domDot, dfgDot } from '../js/ui/dot.js';

const fn = (id, name, ssa = false) => {
    const c = compile(EXAMPLES.find((e) => e.id === id).code);
    return (ssa ? c.ssa.module : c.module).functions.find((F) => F.name === name);
};

test('dominadores, fronteira e laços aninhados (multiplicação de matrizes)', () => {
    const cfg = analyzeCfg(fn('matriz', 'matmul'));
    assert.equal(cfg.idom.get('for.body3'), 'for.cond3');
    assert.equal(cfg.idom.get('for.end'), 'for.cond');
    assert.deepEqual([...cfg.df.get('for.inc3')], ['for.cond3']);
    assert.deepEqual(cfg.loops.map((l) => [l.header, l.depth]), [['for.cond', 1], ['for.cond2', 2], ['for.cond3', 3]]);
    assert.equal(cfg.depth.get('for.body3'), 3);
    assert.equal(cfg.backEdges.length, 3);
    // Todo bloco é dominado pela entrada e por si mesmo.
    for (const b of cfg.blocks) { assert.equal(cfg.doms.get(b)[0], 'entry'); assert.equal(cfg.doms.get(b).at(-1), b); }
});

test('if sem else e curto circuito: junções na fronteira de dominância', () => {
    const cfg = analyzeCfg(fn('logica', 'main'));
    assert.ok(cfg.df.get('land.rhs').has('land.end'));
    assert.equal(cfg.loops.length, 0);
});

test('mem2reg no formato do LLVM', () => {
    const c = compile(EXAMPLES.find((e) => e.id === 'fib').code);
    const t = c.ssa.ir.text;
    assert.match(t, /%a\.0 = phi i32 \[ 0, %entry \], \[ %b\.0, %for\.inc \]/);
    assert.match(t, /%i\.0 = phi i32 \[ 0, %entry \], \[ %\d+, %for\.inc \]/);
    assert.doesNotMatch(t, /alloca|load|store/);
    assert.match(t, /icmp slt i32 %i\.0, %n/);
    // Vetores e variáveis com endereço tomado ficam na memória.
    const s = compile(EXAMPLES.find((e) => e.id === 'swap').code);
    assert.deepEqual(s.ssa.report.find((r) => r.fn === 'main').kept.sort(), ['x', 'y']);
    const b = compile(EXAMPLES.find((e) => e.id === 'soma').code);
    assert.match(b.ssa.ir.text, /%s\.0 = phi i32/);
});

test('DFG: caminho crítico e dependências de memória', () => {
    const g = blockDfg(fn('matriz', 'matmul'), 'for.body3');
    assert.equal(g.length, 16);
    assert.equal(g.seqSum, 41);
    const crit = g.nodes.filter((n) => n.critical).map((n) => n.inst.op);
    assert.deepEqual(crit.slice(-4), ['load', 'mul', 'add', 'store']);
    const gs = blockDfg(fn('matriz', 'matmul', true), 'for.body3');
    assert.equal(gs.length, 13);
    // troca(): o store em *a precisa esperar o load de *b (podem ser o mesmo endereço).
    const t = blockDfg(fn('swap', 'troca', true), 'entry');
    assert.ok(t.edges.some((e) => e.kind === 'mem'));
    for (const n of t.nodes) assert.ok(n.slack >= 0);
});

test('definições e usos', () => {
    const du = defUse(fn('fib', 'fib', true));
    const n = du.find((r) => r.value.name === 'n');
    assert.equal(n.def.inst, null);
    assert.equal(n.uses.length, 1);
    const a0 = du.find((r) => r.value.name === 'a.0');
    assert.equal(a0.uses.length, 2);
});

test('DOT bem formado', () => {
    const F = fn('bubble', 'ordena');
    const cfg = analyzeCfg(F);
    for (const d of [cfgDot(F, cfg), domDot(F, cfg), dfgDot(F, blockDfg(F, 'for.body2'))]) {
        assert.match(d, /^digraph "/);
        assert.equal((d.match(/\{/g) || []).length - (d.match(/\\\{/g) || []).length, (d.match(/\}/g) || []).length - (d.match(/\\\}/g) || []).length);
    }
    assert.match(cfgDot(F, cfg), /Node\d+:s0 -> Node\d+/);
});

test('escalonamento com recursos limitados (HLS)', async () => {
    const { listSchedule, UNIT_OF } = await import('../js/cc/dfg.js');
    const g = blockDfg(fn('matriz', 'matmul', true), 'for.body3');
    const s1 = listSchedule(g, { alu: 1, mul: 1, mem: 1, fpu: 1 });
    const sInf = listSchedule(g, { alu: 8, mul: 8, mem: 8, fpu: 8 });
    assert.equal(sInf.length, g.length);
    assert.ok(s1.length > g.length);
    // Dependências respeitadas e nunca duas operações na mesma unidade ao mesmo tempo (sem pipeline).
    for (const n of s1.nodes) for (const p of n.preds) assert.ok(s1.nodes[p].start + s1.nodes[p].lat <= n.start);
    const busy = new Map();
    for (const n of s1.nodes) {
        if (!UNIT_OF[n.cls]) continue;
        for (let c = n.start; c < n.start + Math.max(1, n.lat); c++) {
            const k = `${n.unit}@${c}`;
            assert.ok(!busy.has(k), k);
            busy.set(k, n.id);
        }
    }
});

test('DFG só com as operações e com latências escolhidas', async () => {
    const { LATENCY } = await import('../js/cc/dfg.js');
    const src = `int img[36]; int gx[36];
int main() {
    for (int c = 7; c < 29; c++) {
        int n = c - 6;
        int s = c + 6;
        int g = img[n + 1] - img[n - 1] + (img[c + 1] << 1) - (img[c - 1] << 1) + img[s + 1] - img[s - 1];
        gx[c] = g;
    }
    return 0;
}`;
    for (const ssa of [false, true]) {
        const r = compile(src);
        const F = (ssa ? r.ssa.module : r.module).functions[0];
        const body = F.blocks.find((b) => b.label === 'for.body');
        const all = blockDfg(F, body.label);
        const ops = blockDfg(F, body.label, LATENCY, { opsOnly: true });
        const opsOf = (g) => g.nodes.map((n) => n.inst.op);
        assert.ok(opsOf(all).includes('load') && opsOf(all).includes('gep'));
        assert.ok(!opsOf(ops).some((o) => ['load', 'store', 'gep'].includes(o)), opsOf(ops).join(','));
        // Na SSA ficam as 5 somas e subtrações e os 2 deslocamentos; no -O0 também n e s, guardados nas suas
        // variáveis na memória. Os 6 valores lidos da imagem viram entradas.
        assert.equal(ops.nodes.filter((n) => ['add', 'sub', 'shl'].includes(n.inst.op)).length, ssa ? 7 : 9, opsOf(ops).join(','));
        assert.ok(ops.inputs.filter((i) => i.fromMem).length >= 6);
        assert.equal(ops.nodes.filter((n) => n.toMem).length, ssa ? 1 : 3);
        assert.equal(ops.edges.filter((e) => e.kind === 'mem').length, 0);
        // Latência de soma 3: o caminho crítico (cadeia de 5 somas depois do deslocamento) cresce.
        const slow = blockDfg(F, body.label, { ...LATENCY, alu: 3 }, { opsOnly: true });
        assert.ok(slow.length > ops.length);
        assert.ok(slow.nodes.every((n) => n.lat === ({ ...LATENCY, alu: 3 })[n.cls]));
    }
});

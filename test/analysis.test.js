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

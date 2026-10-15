import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProfile, approxLatency, delayRatio, unitArea, sameAreaCount } from '../js/cc/axc.js';
import { blockDfg, LATENCY, listSchedule } from '../js/cc/dfg.js';
import { compile } from '../js/cc/compile.js';

// Perfil como o axc-simulator manda (MUL8 DRUM4, números da síntese sky130).
const drum = { name: 'MUL8 DRUM4', width: 8, gates: 358, gatesExact: 320, depth: 33, depthExact: 29, MRED: 0.0589, asic: { area: 1293.74, areaExact: 2539.94, delay: 3118.35, delayExact: 1979.79 } };
const t8 = { name: 'MUL8 T8', width: 8, gates: 140, gatesExact: 320, depth: 19, depthExact: 29, MRED: 0.0978 };

test('perfil do multiplicador aproximado: validação, latência e área', () => {
    assert.equal(parseProfile(null), null);
    assert.equal(parseProfile({ name: 'x', gates: 0, gatesExact: 1, depth: 1, depthExact: 1 }), null);
    const d = parseProfile(drum), tr = parseProfile(t8);
    // Com síntese, a razão de atraso vem do ASIC; sem, da profundidade do modelo de portas.
    assert.equal(delayRatio(d).source, 'asic');
    assert.equal(delayRatio(tr).source, 'gates');
    assert.equal(approxLatency(4, d), 7);          // 4 x 1,575 = 6,3 -> 7
    assert.equal(approxLatency(4, tr), 3);         // 4 x 19 / 29 = 2,6 -> 3
    assert.equal(approxLatency(1, tr), 1);
    assert.deepEqual(unitArea(d), { approx: 1293.74, exact: 2539.94, unit: 'µm²' });
    assert.equal(sameAreaCount(1, d), 1);
    assert.equal(sameAreaCount(2, d), 3);
    assert.equal(sameAreaCount(1, tr), 2);
});

test('a latência do multiplicador aproximado muda o escalonamento do bloco', () => {
    const c = compile('int a[8]; int b[8]; int main() { int s = 0; for (int i = 0; i < 8; i = i + 1) s = s + a[i] * b[i] * 3; return s; }');
    const F = c.ssa.module.functions.find((f) => f.name === 'main');
    const block = F.blocks.find((b) => b.insts.some((i) => i.op === 'mul')).label;
    const exact = blockDfg(F, block, LATENCY, { opsOnly: true });
    const fast = blockDfg(F, block, { ...LATENCY, mul: approxLatency(LATENCY.mul, parseProfile(t8)) }, { opsOnly: true });
    assert.ok(fast.length < exact.length);
    const res = { alu: 1, mul: 1, mem: 1, fpu: 1 };
    assert.ok(listSchedule(fast, res).length <= listSchedule(exact, res).length);
});

test('perfis das configurações sintetizadas do axc e somador aproximado no grafo', async () => {
    const { profilesFromSynth } = await import('../js/cc/axc.js');
    const d = (name, cfg, gates, gateDepth, area, delay, MRED) => ({ name, cfg, gates, gateDepth, asic: { area, delay }, err: { MRED, NMED: 0, EP: 0 } });
    const synth = { designs: [
        d('MUL8 exato', { kind: 'mul', width: 8 }, 320, 29, 2540, 1980, 0),
        d('MUL8 T4', { kind: 'mul', width: 8, kTrunc: 4 }, 280, 26, 2185, 2029, 0.0056),
        d('MUL8 BOOTH', { kind: 'mul', width: 8, method: 'booth' }, 375, 34, 2690, 2525, 0),
        d('MUL8 BOOTH T4', { kind: 'mul', width: 8, method: 'booth', kTrunc: 4 }, 351, 31, 2323, 2399, 0.027),
        d('ADD16 exato', { kind: 'add', width: 16, adder: 'exact' }, 80, 31, 666, 1265, 0),
        d('ADD16 LOA8', { kind: 'add', width: 16, adder: 'loa', k: 8 }, 49, 17, 347, 1087, 0.001),
    ] };
    const ps = profilesFromSynth(synth);
    assert.deepEqual(ps.map((p) => `${p.kind} ${p.name}`), ['mul MUL8 T4', 'mul MUL8 BOOTH T4', 'add ADD16 LOA8']);
    const booth = ps.find((p) => p.name === 'MUL8 BOOTH T4');
    assert.equal(booth.areaExact, 2690);      // comparado com o Booth exato
    const loa = ps.find((p) => p.kind === 'add');
    assert.equal(approxLatency(1, loa), 1);   // a ULA de 1 ciclo não fica mais rápida
    assert.equal(approxLatency(2, loa), 2);   // 2 x 0,86 = 1,7 -> 2
    assert.equal(sameAreaCount(1, loa), 1);
    assert.equal(sameAreaCount(2, loa), 3);
    // No grafo, soma e subtração seguem a latência da ULA, ou a própria quando há somador aproximado.
    const c = compile('int a[8]; int main() { int s = 0; for (int i = 0; i < 8; i = i + 1) s = s + a[i] - i; return s; }');
    const F = c.ssa.module.functions.find((f) => f.name === 'main');
    const block = F.blocks.find((b) => b.insts.some((i) => i.op === 'sub')).label;
    const g1 = blockDfg(F, block, { ...LATENCY, alu: 2 });
    assert.ok(g1.nodes.filter((n) => n.cls === 'add').every((n) => n.lat === 2));
    const g2 = blockDfg(F, block, { ...LATENCY, alu: 2, add: 3 });
    assert.ok(g2.nodes.filter((n) => n.cls === 'add').every((n) => n.lat === 3));
    assert.ok(g2.length > g1.length);
});

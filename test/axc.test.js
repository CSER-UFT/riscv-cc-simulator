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

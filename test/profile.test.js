import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../js/cc/compile.js';
import { interpret } from '../js/cc/irinterp.js';
import { blockFrequencies, blockCounts, simulateProfile, branchProbabilities } from '../js/cc/profile.js';
import { analyzeCfg } from '../js/cc/cfg.js';
import { EXAMPLES } from '../js/examples.js';

const ex = (id) => compile(EXAMPLES.find((e) => e.id === id).code);

test('frequência estática: heurística de laço do LLVM (31/32) e desvios meio a meio', () => {
    const c = ex('matriz');
    const F = c.module.functions.find((f) => f.name === 'matmul');
    const { freq } = blockFrequencies(F);
    assert.ok(Math.abs(freq.get('for.cond') - 32) < 1e-9);
    assert.ok(Math.abs(freq.get('for.body3') - 31 ** 3) < 1e-6);
    assert.ok(Math.abs(freq.get('for.end') - 1) < 1e-9);
    const b = ex('bubble').module.functions.find((f) => f.name === 'ordena');
    const p = branchProbabilities(analyzeCfg(b));
    assert.equal(p.get('for.body2>if.then'), 0.5);
});

test('execuções medidas pelo interpretador por bloco', () => {
    const c = ex('matriz');
    const F = c.module.functions.find((f) => f.name === 'matmul');
    const cnt = blockCounts(F, interpret(c.module).counts);
    assert.equal(cnt.get('for.body3'), 27);
    assert.equal(cnt.get('for.cond3'), 36);
});

test('perfil no simulador de processadores: ciclos atribuídos somam o total', () => {
    for (const id of ['soma', 'fatorial', 'bubble']) {
        const c = ex(id);
        for (const model of ['single', 'pipeline', 'dual']) {
            for (const caches of [false, true]) {
                const p = simulateProfile(c.asm.text, { model, caches });
                assert.equal(p.errors.length, 0);
                assert.ok(p.finished);
                const sum = p.per.reduce((s, x) => s + x.cycles, 0);
                assert.ok(sum <= p.cycles && sum >= p.cycles - 6, `${id} ${model}: ${sum} de ${p.cycles}`);
                const exec = p.per.reduce((s, x) => s + x.exec, 0);
                assert.equal(exec, p.instructions);
                if (model === 'single' && !caches) assert.equal(p.cycles, p.instructions);
            }
        }
        // O número de instruções concluídas é o mesmo do simulador funcional.
        assert.equal(simulateProfile(c.asm.text, { model: 'pipeline' }).instructions, compile(EXAMPLES.find((e) => e.id === id).code) && simulateProfile(c.asm.text, { model: 'single' }).instructions);
    }
});

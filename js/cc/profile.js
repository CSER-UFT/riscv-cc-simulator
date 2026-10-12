/**
 * Dados do mapa de calor.
 *
 * Estático: frequência estimada de cada bloco, sem executar o programa, como a análise BlockFrequencyInfo do
 * LLVM. Cada desvio condicional recebe uma probabilidade (a heurística de laço do LLVM: a aresta que continua no
 * laço tem 31/32 e a que sai, 1/32; nos demais, metade para cada lado), e as frequências resolvem o sistema
 * freq(b) = [b é a entrada] + soma, para cada predecessor p, de freq(p) vezes prob(p, b).
 *
 * Dinâmico: execuções de cada instrução da IR (interpretador), e execuções e ciclos de cada instrução RISC-V em
 * um modelo do simulador de processadores (monociclo, pipeline ou emissão dupla). Os ciclos são atribuídos na
 * conclusão: cada instrução fica com os ciclos desde a conclusão da anterior, de modo que a soma dá o total, e as
 * bolhas, os acessos lentos à memória e os desvios mal previstos aparecem na instrução que os sofreu.
 */
import { analyzeCfg } from './cfg.js';
import { assemble } from '../vendor/cpu/riscv/parser.js';
import { simulate } from '../vendor/cpu/simulator.js';

export const LOOP_STAY = 31 / 32;

/** Probabilidade de cada aresta do CFG ("origem>destino"). */
export function branchProbabilities(cfg) {
    const prob = new Map();
    for (const b of cfg.blocks) {
        const succ = cfg.succ.get(b);
        if (succ.length === 1) { prob.set(`${b}>${succ[0].to}`, 1); continue; }
        if (succ.length !== 2) continue;
        // Uma aresta sai de um laço que contém o bloco e a outra não: heurística de laço.
        const exits = succ.map((s) => cfg.loops.some((l) => l.body.has(b) && !l.body.has(s.to)));
        if (exits[0] !== exits[1]) {
            succ.forEach((s, k) => prob.set(`${b}>${s.to}`, exits[k] ? 1 - LOOP_STAY : LOOP_STAY));
        } else succ.forEach((s) => prob.set(`${b}>${s.to}`, 0.5));
    }
    return prob;
}

/** Frequência estimada de cada bloco, relativa a uma chamada da função (entrada = 1). */
export function blockFrequencies(F, cfg = analyzeCfg(F)) {
    const prob = branchProbabilities(cfg);
    const bl = cfg.rpo, n = bl.length, idx = new Map(bl.map((b, i) => [b, i]));
    // (I - P^T) f = e
    const A = Array.from({ length: n }, (_, i) => { const r = new Float64Array(n + 1); r[i] = 1; return r; });
    A[0][n] = 1;
    for (const [k, p] of prob) {
        const [from, to] = k.split('>');
        if (!idx.has(from) || !idx.has(to)) continue;
        A[idx.get(to)][idx.get(from)] -= p;
    }
    for (let c = 0; c < n; c++) {
        let piv = c;
        for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
        [A[c], A[piv]] = [A[piv], A[c]];
        const d = A[c][c];
        if (Math.abs(d) < 1e-12) continue;
        for (let r = 0; r < n; r++) {
            if (r === c || A[r][c] === 0) continue;
            const f = A[r][c] / d;
            for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
        }
    }
    const freq = new Map(bl.map((b, i) => [b, Math.abs(A[i][i]) < 1e-12 ? 0 : A[i][n] / A[i][i]]));
    return { freq, prob };
}

/** Execuções de cada bloco pelo interpretador (a contagem do terminador). */
export function blockCounts(F, counts) {
    return new Map(F.blocks.map((b) => [b.label, counts.get(b.insts[b.insts.length - 1]) ?? 0]));
}

/**
 * Executa o assembly em um modelo do simulador de processadores e resume por instrução estática.
 * @param {string} asmText
 * @param {{model?: string, caches?: boolean, maxCycles?: number}} opts
 */
export function simulateProfile(asmText, { model = 'pipeline', caches = false, maxCycles = 100000 } = {}) {
    const program = assemble(asmText);
    if (program.errors.length) return { errors: program.errors };
    const sim = simulate(program, { mode: model, trace: false, maxCycles, exampleValues: false, memory: { enabled: caches } });
    if (sim.errors?.length) return { errors: sim.errors };
    const per = program.instructions.map(() => ({ exec: 0, cycles: 0, stalls: 0, squashed: 0 }));
    const done = sim.dyn.filter((d) => d.commit !== null && d.squashed === null).sort((a, b) => a.commit - b.commit || a.id - b.id);
    let prev = 0;
    for (const d of done) {
        const p = per[d.index];
        p.exec++;
        p.cycles += d.commit - prev;
        prev = d.commit;
        p.stalls += d.marks.filter((m) => m[1] === 'Stall').length;
    }
    for (const d of sim.dyn) if (d.squashed !== null) per[d.index].squashed++;
    return {
        errors: [], program, per, stats: sim.stats, finished: sim.finished, model,
        cycles: sim.stats.cycles, instructions: done.length, stalls: per.reduce((s, p) => s + p.stalls, 0),
        squashed: per.reduce((s, p) => s + p.squashed, 0),
    };
}

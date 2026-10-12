/**
 * Experimentos de computação aproximada: para cada valor do parâmetro de uma técnica, compila, executa e mede o
 * erro das saídas (contra a versão exata, sem otimização) e o ganho em ciclos no simulador de processadores
 * (contra a versão exata com as mesmas otimizações clássicas).
 */
import { buildVariant } from './compile.js';
import { optimize, outputError } from './opt.js';
import { interpret } from './irinterp.js';
import { simulateProfile } from './profile.js';

export const SWEEPS = {
    perforate: [1, 2, 3, 4, 6, 8],
    fprec: [23, 18, 14, 12, 10, 8, 6, 4, 2],
    amul: [0, 1, 2, 3, 4, 5, 6, 8],
};

/**
 * Mede uma configuração.
 * @param {object} c saída de compile()
 * @param {object} opts opções de optimize()
 * @param {object} ref resultado do interpretador na versão exata
 */
export function measure(c, opts, ref, { model = 'pipeline', maxSteps = 2000000 } = {}) {
    const { module, log } = optimize(c.ssa.module, opts);
    const variant = buildVariant(c, module);
    const out = interpret(module, { maxSteps });
    const prof = simulateProfile(variant.asm.text, { model });
    return { module, log, variant, out, err: outputError(ref, out), prof, cycles: prof.errors?.length ? null : prof.cycles, steps: out.steps };
}

/**
 * Varre os valores de uma técnica.
 * @param {'perforate'|'fprec'|'amul'} tech
 * @param {{classic: string[], loop?: {fn, header}}} base
 */
export function sweep(c, tech, base, { model = 'pipeline', values = SWEEPS[tech] } = {}) {
    const ref = interpret(c.module);
    const exact = measure(c, { classic: base.classic }, ref, { model });
    return values.map((x) => {
        const opts = { classic: base.classic };
        if (tech === 'perforate') opts.perforate = { ...base.loop, k: x };
        if (tech === 'fprec') opts.fprec = x;
        if (tech === 'amul') opts.amul = x;
        const m = measure(c, opts, ref, { model });
        return {
            x, mre: m.err.mre, maxAbs: m.err.maxAbs, same: m.err.same, finished: m.err.finished && m.prof.finished !== false,
            cycles: m.cycles, speedup: m.cycles && exact.cycles ? exact.cycles / m.cycles : null, ret: m.out.ret,
        };
    });
}

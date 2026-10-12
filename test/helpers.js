import { compile } from '../js/cc/compile.js';
import { interpret } from '../js/cc/irinterp.js';
import { runAsm } from '../js/cc/run.js';
import { buildVariant } from '../js/cc/compile.js';
import { optimize, CLASSIC } from '../js/cc/opt.js';

/** Compila, interpreta a IR e executa o assembly; devolve os dois resultados. */
export function both(src, opts = {}, comp = compile) {
    const c = comp(src, opts);
    if (c.errors.length) throw new Error(`compile: ${JSON.stringify(c.errors)}`);
    const ir = interpret(c.module);
    const asm = runAsm(c);
    if (asm.errors.length) throw new Error(`asm: ${JSON.stringify(asm.errors)}\n${c.asm.text}`);
    // A forma SSA (depois da mem2reg) precisa dar o mesmo resultado, interpretada e compilada.
    const ssaIr = interpret(c.ssa.module);
    const ssaAsm = runAsm({ ...c, module: c.ssa.module, asm: c.ssa.asm });
    if (ssaAsm.errors.length) throw new Error(`asm ssa: ${JSON.stringify(ssaAsm.errors)}\n${c.ssa.asm.text}`);
    // As otimizações clássicas também não podem mudar o resultado.
    const opt = buildVariant(c, optimize(c.ssa.module, { classic: CLASSIC }).module);
    const optIr = interpret(opt.module);
    const optAsm = runAsm({ ...c, module: opt.module, asm: opt.asm });
    if (optAsm.errors.length) throw new Error(`asm opt: ${JSON.stringify(optAsm.errors)}\n${opt.asm.text}`);
    // Alocação de registradores: o assembly das três versões precisa dar o mesmo resultado da IR.
    const ra = comp(src, { ...opts, regalloc: true });
    const raOpt = buildVariant(ra, optimize(ra.ssa.module, { classic: CLASSIC }).module);
    const raRuns = [runAsm(ra), runAsm({ ...ra, module: ra.ssa.module, asm: ra.ssa.asm }), runAsm({ ...ra, module: raOpt.module, asm: raOpt.asm })];
    raRuns.forEach((r, k) => {
        if (r.errors.length) throw new Error(`asm regalloc ${k}: ${JSON.stringify(r.errors)}`);
        const same = Object.is(r.ret, ir.ret) && [...ir.globals].every(([g, v]) => JSON.stringify(r.globals.get(g)) === JSON.stringify(v));
        if (!same || r.reason !== 'end') throw new Error(`regalloc ${k}: ${r.ret} != ${ir.ret} (${r.reason})\n${[ra.asm, ra.ssa.asm, raOpt.asm][k].text}`);
    });
    // Escalonamento de instruções (com e sem alocação de registradores): mesma resposta.
    for (const cfg of [{ regalloc: false, schedule: 'dual' }, { regalloc: true, schedule: 'pipeline' }]) {
        const sc = comp(src, { ...opts, ...cfg });
        const so = buildVariant(sc, optimize(sc.ssa.module, { classic: CLASSIC }).module);
        [runAsm(sc), runAsm({ ...sc, module: sc.ssa.module, asm: sc.ssa.asm }), runAsm({ ...sc, module: so.module, asm: so.asm })].forEach((r, k) => {
            const same = !r.errors.length && r.reason === 'end' && Object.is(r.ret, ir.ret) && [...ir.globals].every(([g, v]) => JSON.stringify(r.globals.get(g)) === JSON.stringify(v));
            if (!same) throw new Error(`escalonamento ${JSON.stringify(cfg)} ${k}: ${r.ret} != ${ir.ret}\n${[sc.asm, sc.ssa.asm, so.asm][k].text}`);
        });
    }
    return { c, ir, asm, ssaIr, ssaAsm, optIr, optAsm, raRuns };
}

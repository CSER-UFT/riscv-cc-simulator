import { compile } from '../js/cc/compile.js';
import { interpret } from '../js/cc/irinterp.js';
import { runAsm } from '../js/cc/run.js';
import { buildVariant } from '../js/cc/compile.js';
import { optimize, CLASSIC } from '../js/cc/opt.js';

/** Compila, interpreta a IR e executa o assembly; devolve os dois resultados. */
export function both(src, opts = {}) {
    const c = compile(src, opts);
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
    return { c, ir, asm, ssaIr, ssaAsm, optIr, optAsm };
}

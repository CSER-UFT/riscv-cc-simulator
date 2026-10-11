import { compile } from '../js/cc/compile.js';
import { interpret } from '../js/cc/irinterp.js';
import { runAsm } from '../js/cc/run.js';

/** Compila, interpreta a IR e executa o assembly; devolve os dois resultados. */
export function both(src, opts = {}) {
    const c = compile(src, opts);
    if (c.errors.length) throw new Error(`compile: ${JSON.stringify(c.errors)}`);
    const ir = interpret(c.module);
    const asm = runAsm(c);
    if (asm.errors.length) throw new Error(`asm: ${JSON.stringify(asm.errors)}\n${c.asm.text}`);
    return { c, ir, asm };
}

/**
 * Encadeia as fases do compilador: análise léxica, sintática e semântica, geração da IR e do assembly.
 * Cada fase só roda se a anterior terminou sem erros.
 */
import { lex } from './lexer.js';
import { parse } from './parser.js';
import { analyze } from './sema.js';
import { generateIR, printModule } from './irgen.js';
import { generateAsm } from './codegen.js';
import { mem2regModule } from './mem2reg.js';
import { parseLL } from './ll.js';

/**
 * @param {string} source código MiniC
 * @param {{irComments?: boolean, srcComments?: boolean, tr?: Function}} opts
 */
export function compile(source, opts = {}) {
    const r = { source, phase: 'lex', errors: [], warnings: [] };
    const L = lex(source);
    r.tokens = L.tokens;
    if (L.errors.length) { r.errors = L.errors; return r; }
    r.phase = 'parse';
    const P = parse(L.tokens);
    r.ast = P.ast;
    r.nodes = P.nodes;
    if (P.errors.length) { r.errors = P.errors; return r; }
    r.phase = 'sema';
    const S = analyze(P.ast);
    r.sema = S;
    r.warnings = S.warnings;
    if (S.errors.length) { r.errors = S.errors.sort((a, b) => a.line - b.line || a.col - b.col); return r; }
    r.phase = 'ir';
    r.module = generateIR(P.ast, S);
    return backEnd(r, opts);
}

/**
 * Importa IR do LLVM (.ll, como a do clang -O0) e segue pelas mesmas fases do simulador a partir da IR.
 * @param {string} source texto do .ll
 */
export function compileLL(source, opts = {}) {
    const r = { source, lang: 'll', phase: 'll', errors: [], warnings: [] };
    const L = parseLL(source);
    if (L.errors.length) { r.errors = L.errors; return r; }
    r.phase = 'ir';
    r.module = L.module;
    return backEnd(r, opts);
}

/** IR impressa, mem2reg e assembly: a parte comum ao MiniC e ao .ll importado. */
function backEnd(r, opts) {
    const source = r.source;
    r.ir = printModule(r.module);
    // A mesma IR depois da mem2reg (forma SSA), com o seu próprio assembly.
    const M = mem2regModule(r.module);
    r.ssa = { module: M.module, report: M.report, ir: printModule(M.module) };
    r.phase = 'asm';
    r.genOpts = { source, irComments: opts.irComments, srcComments: opts.srcComments, tr: opts.tr ?? null, regalloc: !!opts.regalloc, schedule: opts.schedule ?? 'none' };
    const gen = (module) => {
        const A = generateAsm(module, r.genOpts);
        return { frames: A.frames, out: A.out, asm: A.render(opts.tr ?? null), mainFloat: A.mainFloat, moved: A.moved };
    };
    const A = gen(r.module);
    r.frames = A.frames;
    r.mainFloat = A.mainFloat;
    r.asmOut = A.out;
    r.asm = A.asm;
    const B = gen(r.ssa.module);
    r.ssa.frames = B.frames;
    r.ssa.asm = B.asm;
    r.ssa.moved = B.moved;
    r.moved = A.moved;
    r.phase = 'done';
    return r;
}

/**
 * IR impressa, assembly e quadros de um módulo qualquer (por exemplo, o resultado das otimizações).
 * @param {object} r saída de compile()
 */
export function buildVariant(r, module) {
    const ir = printModule(module);
    const A = generateAsm(module, r.genOpts);
    return { module, ir, asm: A.render(r.genOpts.tr), frames: A.frames, moved: A.moved };
}

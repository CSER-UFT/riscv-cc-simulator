/**
 * Encadeia as fases do compilador: análise léxica, sintática e semântica, geração da IR e do assembly.
 * Cada fase só roda se a anterior terminou sem erros.
 */
import { lex } from './lexer.js';
import { parse } from './parser.js';
import { analyze } from './sema.js';
import { generateIR, printModule } from './irgen.js';
import { generateAsm } from './codegen.js';

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
    r.ir = printModule(r.module);
    r.phase = 'asm';
    const A = generateAsm(r.module, { source, irComments: opts.irComments, srcComments: opts.srcComments });
    r.frames = A.frames;
    r.mainFloat = A.mainFloat;
    r.asmOut = A.out;
    r.asm = A.render(opts.tr ?? null);
    r.phase = 'done';
    return r;
}

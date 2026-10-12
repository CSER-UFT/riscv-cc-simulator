/**
 * Destaque de sintaxe (mesmas classes dos outros simuladores) para as três linguagens do compilador:
 * MiniC (o código fonte), a IR no formato do LLVM e o assembly RISC-V.
 */
import { lookup, PSEUDO_INSTRUCTIONS } from '../vendor/cpu/riscv/isa.js';
import { canonical } from '../vendor/cpu/riscv/registers.js';
import { KEYWORDS } from '../cc/lexer.js';

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const span = (cls, s) => `<span class="${cls}">${esc(s)}</span>`;
const TYPES = new Set(['int', 'float', 'void']);

/**
 * MiniC, com os comentários de várias linhas. Devolve uma linha de HTML por linha do fonte.
 * @returns {string[]}
 */
export function minicLines(src) {
    const out = [];
    let cur = '', inComment = false;
    const re = /(\/\*)|(\*\/)|(\/\/.*)|([A-Za-z_]\w*)|(0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[fF]?)|(\n)|(\s+)|(.)/g;
    let m, comment = '';
    while ((m = re.exec(src)) !== null) {
        const [tok, open, close, line, word, num, nl] = m;
        if (nl) {
            if (inComment) { cur += span('hl-com', comment); comment = ''; }
            out.push(cur);
            cur = '';
            continue;
        }
        if (inComment) {
            comment += tok;
            if (close) { cur += span('hl-com', comment); comment = ''; inComment = false; }
            continue;
        }
        if (open) { inComment = true; comment = tok; continue; }
        if (line) cur += span('hl-com', tok);
        else if (word) cur += TYPES.has(word) ? span('hl-type', tok) : KEYWORDS.has(word) ? span('hl-op', tok) : esc(tok);
        else if (num) cur += span('hl-num', tok);
        else cur += esc(tok);
    }
    if (inComment) cur += span('hl-com', comment);
    out.push(cur);
    return out;
}

const IR_WORDS = new Set(['define', 'global', 'alloca', 'load', 'store', 'getelementptr', 'inbounds', 'br', 'label', 'ret', 'phi', 'call',
    'icmp', 'fcmp', 'zext', 'sitofp', 'fptosi', 'ptrtoint', 'to', 'fneg', 'add', 'sub', 'mul', 'sdiv', 'srem', 'and', 'or', 'xor', 'shl',
    'ashr', 'fadd', 'fsub', 'fmul', 'fdiv', 'zeroinitializer', 'null', 'true', 'false']);
const IR_FLAGS = new Set(['nsw', 'exact', 'slt', 'sle', 'sgt', 'sge', 'eq', 'ne', 'ult', 'ule', 'ugt', 'uge', 'olt', 'ole', 'ogt', 'oge', 'oeq', 'une']);
const IR_TYPES = /^(i1|i32|float|ptr|void)$/;

/** Uma linha da IR. */
export function irLine(line) {
    const c = line.indexOf(';');
    const code = c >= 0 ? line.slice(0, c) : line;
    let out = '', m;
    const re = /([%@][\w.]+)|(^[\w.]+:)|(\[\d+ x (?:i32|float)\])|([A-Za-z_][\w.]*)|(-?0x[0-9A-F]+|-?\d+(?:\.\d+)?(?:e[+-]\d+)?)|(\s+)|(.)/g;
    while ((m = re.exec(code)) !== null) {
        const [tok, val, lab, arr, word, num] = m;
        if (val) out += span(tok[0] === '@' ? 'hl-label' : 'hl-reg', tok);
        else if (lab) out += span('hl-label', tok);
        else if (arr) out += span('hl-type', tok);
        else if (word) out += IR_TYPES.test(word) ? span('hl-type', tok) : IR_WORDS.has(word) ? span('hl-op', tok) : IR_FLAGS.has(word) ? span('hl-dir', tok) : esc(tok);
        else if (num) out += span('hl-num', tok);
        else out += esc(tok);
    }
    if (c >= 0) out += span('hl-com', line.slice(c));
    return out;
}

const PSEUDO = new Set(PSEUDO_INSTRUCTIONS);
const isMnemonic = (w) => lookup(w) !== null || PSEUDO.has(w.toLowerCase());

/** Uma linha de assembly RISC-V. */
export function asmLine(line) {
    const c = line.indexOf('#');
    const code = c >= 0 ? line.slice(0, c) : line;
    let out = '', first = true, m;
    const re = /(%(?:hi|lo)\([\w.]+\))|([A-Za-z_.$][\w.$]*:?)|([+-]?(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?))|(\s+)|(.)/g;
    while ((m = re.exec(code)) !== null) {
        const [tok, rel, word, num, space] = m;
        if (space) out += tok;
        else if (rel) out += span('hl-dir', tok);
        else if (num) out += span('hl-num', tok);
        else if (word) {
            if (word.endsWith(':')) out += span('hl-label', tok);
            else if (first && word.startsWith('.')) { out += span('hl-dir', tok); first = false; }
            else if (first && isMnemonic(word)) { out += span('hl-op', tok); first = false; }
            else if (canonical(word)) out += span('hl-reg', tok);
            else out += esc(tok);
        } else out += esc(tok);
    }
    if (c >= 0) out += span('hl-com', line.slice(c));
    return out;
}

/**
 * Análise léxica do MiniC: transforma o texto em uma lista de tokens com tipo, lexema, linha e coluna.
 *
 * O reconhecedor é escrito à mão, como um autômato finito: o primeiro caractere escolhe o estado
 * (identificador, número, operador...) e o laço consome caracteres enquanto o estado aceitar. Cada token
 * guarda também o estado final (o tipo) e a posição, usados na tabela de tokens e no destaque do código.
 */
import { t } from '../i18n/index.js';

export const KEYWORDS = new Set(['int', 'float', 'void', 'if', 'else', 'while', 'for', 'return', 'break', 'continue']);

/** Operadores e pontuação, do mais longo para o mais curto (o reconhecedor prefere o mais longo). */
const OPERATORS = [
    '<<=', '>>=',
    '==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=', '<<', '>>',
    '+', '-', '*', '/', '%', '<', '>', '=', '!', '&', '|', '^', '~', '(', ')', '{', '}', '[', ']', ';', ',',
];

/** Categoria de cada token, usada na tabela e no destaque. */
export const TOKEN_KINDS = ['keyword', 'ident', 'int', 'float', 'op', 'punct', 'eof'];
const PUNCT = new Set(['(', ')', '{', '}', '[', ']', ';', ',']);

/**
 * @param {string} src código fonte
 * @returns {{tokens: Array<{kind: string, text: string, line: number, col: number, end: number, value?: number}>, errors: Array}}
 */
export function lex(src) {
    const tokens = [], errors = [];
    let i = 0, line = 1, col = 1;
    const peek = (k = 0) => src[i + k] ?? '';
    const advance = () => {
        const c = src[i++];
        if (c === '\n') { line++; col = 1; } else col++;
        return c;
    };
    while (i < src.length) {
        const c = peek();
        // Espaços e comentários.
        if (/\s/.test(c)) { advance(); continue; }
        if (c === '/' && peek(1) === '/') { while (i < src.length && peek() !== '\n') advance(); continue; }
        if (c === '/' && peek(1) === '*') {
            const l0 = line, c0 = col;
            advance(); advance();
            while (i < src.length && !(peek() === '*' && peek(1) === '/')) advance();
            if (i >= src.length) { errors.push({ line: l0, col: c0, message: t('err.lex.comment') }); break; }
            advance(); advance();
            continue;
        }
        const start = i, l = line, cl = col;
        // Identificadores e palavras reservadas.
        if (/[A-Za-z_]/.test(c)) {
            while (/[A-Za-z0-9_]/.test(peek())) advance();
            const text = src.slice(start, i);
            tokens.push({ kind: KEYWORDS.has(text) ? 'keyword' : 'ident', text, line: l, col: cl, end: i, start });
            continue;
        }
        // Números: inteiro decimal ou hexadecimal, ou ponto flutuante (com ponto ou expoente).
        if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(peek(1)))) {
            if (c === '0' && /[xX]/.test(peek(1))) {
                advance(); advance();
                while (/[0-9A-Fa-f]/.test(peek())) advance();
            } else {
                while (/[0-9]/.test(peek())) advance();
                let isFloat = false;
                if (peek() === '.') { isFloat = true; advance(); while (/[0-9]/.test(peek())) advance(); }
                if (/[eE]/.test(peek()) && /[0-9+-]/.test(peek(1))) {
                    isFloat = true;
                    advance();
                    if (/[+-]/.test(peek())) advance();
                    while (/[0-9]/.test(peek())) advance();
                }
                if (isFloat) {
                    if (/[fF]/.test(peek())) advance();
                    const text = src.slice(start, i);
                    tokens.push({ kind: 'float', text, value: Math.fround(parseFloat(text)), line: l, col: cl, end: i, start });
                    continue;
                }
            }
            if (/[A-Za-z_]/.test(peek())) {
                while (/[A-Za-z0-9_]/.test(peek())) advance();
                errors.push({ line: l, col: cl, message: t('err.lex.number', { text: src.slice(start, i) }) });
                continue;
            }
            const text = src.slice(start, i);
            const v = Number(text);
            if (v > 0xFFFFFFFF) errors.push({ line: l, col: cl, message: t('err.lex.big', { text }) });
            tokens.push({ kind: 'int', text, value: v | 0, line: l, col: cl, end: i, start });
            continue;
        }
        const op = OPERATORS.find((o) => src.startsWith(o, i));
        if (op) {
            for (let k = 0; k < op.length; k++) advance();
            tokens.push({ kind: PUNCT.has(op) ? 'punct' : 'op', text: op, line: l, col: cl, end: i, start });
            continue;
        }
        errors.push({ line: l, col: cl, message: t('err.lex.char', { ch: c }) });
        advance();
    }
    tokens.push({ kind: 'eof', text: '', line, col, end: i, start: i });
    return { tokens, errors };
}

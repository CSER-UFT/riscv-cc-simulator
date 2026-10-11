/**
 * Análise sintática do MiniC por descida recursiva: cada regra da gramática é uma função que consome tokens e
 * devolve um nó da árvore sintática abstrata (AST). As expressões seguem a precedência do C, do operador de
 * menor precedência (atribuição) ao de maior (pós-fixos), cada nível em uma função.
 *
 * Gramática (EBNF):
 *   programa   = { declaracao_global | funcao }
 *   tipo       = ("int" | "float" | "void") ["*"]
 *   decl       = tipo declarador { "," declarador } ";"
 *   declarador = ident ["[" inteiro "]"] ["=" (expr | "{" expr {"," expr} "}")]
 *   funcao     = tipo ident "(" [param {"," param}] ")" (bloco | ";")
 *   param      = tipo ident ["[" "]"]
 *   bloco      = "{" { decl | comando } "}"
 *   comando    = bloco | if | while | for | "return" [expr] ";" | "break" ";" | "continue" ";" | [expr] ";"
 *   expr       = atribuicao, com os níveis || && | ^ & (== !=) (< <= > >=) (<< >>) (+ -) (* / %),
 *                unários (- ! ~ & * ++ --) e pós fixos (índice, chamada, ++ --)
 *
 * Cada nó recebe um número sequencial (ordem de criação), usado para mostrar a árvore crescendo, e a posição
 * no código (linha e coluna), usada para relacionar o nó com os tokens, a IR e o assembly.
 */
import { t } from '../i18n/index.js';

class ParseError extends Error {
    constructor(tok, message) {
        super(message);
        this.line = tok.line;
        this.col = tok.col;
    }
}

const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=']);
/** Níveis de operadores binários, do menos para o mais prioritário. */
const BINARY_LEVELS = [
    ['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '<=', '>', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%'],
];

/**
 * @param {Array} tokens saída de lex()
 * @returns {{ast: object|null, nodes: object[], errors: Array}}
 */
export function parse(tokens) {
    let p = 0;
    const nodes = [];
    const peek = (k = 0) => tokens[Math.min(p + k, tokens.length - 1)];
    const next = () => tokens[p++];
    const is = (text, k = 0) => peek(k).text === text && peek(k).kind !== 'ident' && peek(k).kind !== 'int' && peek(k).kind !== 'float';
    const fail = (tok, key, params = {}) => { throw new ParseError(tok, t(key, { tok: tok.kind === 'eof' ? t('err.eof') : tok.text, ...params })); };
    const expect = (text) => {
        if (!is(text)) fail(peek(), 'err.parse.expected', { what: text });
        return next();
    };
    const node = (kind, tok, fields = {}) => {
        const n = { kind, id: nodes.length, line: tok.line, col: tok.col, ...fields };
        nodes.push(n);
        return n;
    };
    const isType = (k = 0) => ['int', 'float', 'void'].includes(peek(k).text) && peek(k).kind === 'keyword';

    function typeSpec() {
        const tok = next();
        let ptr = false;
        if (is('*')) { next(); ptr = true; }
        if (is('*')) fail(peek(), 'err.parse.ptrptr');
        return { base: tok.text, ptr };
    }

    function ident() {
        const tok = peek();
        if (tok.kind !== 'ident') fail(tok, 'err.parse.ident');
        return next();
    }

    // Declarações ---------------------------------------------------------------------------------------------

    function declarators(type, global, startTok) {
        const list = [];
        for (let first = true; ; first = false) {
            // Em "int *p, *q;" cada nome depois do primeiro traz o próprio *.
            if (!first) {
                type = { base: type.base, ptr: false };
                if (is('*')) { next(); type.ptr = true; }
                if (is('*')) fail(peek(), 'err.parse.ptrptr');
            }
            const nameTok = ident();
            let arrayLen = null;
            if (is('[')) {
                next();
                const n = peek();
                if (n.kind !== 'int') fail(n, 'err.parse.arraySize');
                next();
                arrayLen = n.value;
                expect(']');
            }
            const decl = node('VarDecl', nameTok, { type, name: nameTok.text, arrayLen, init: null, global, startLine: startTok.line });
            if (is('=')) {
                next();
                if (is('{')) {
                    const brace = next();
                    const items = [expression()];
                    while (is(',')) { next(); items.push(expression()); }
                    expect('}');
                    decl.init = node('InitList', brace, { items });
                } else {
                    decl.init = expression();
                }
            }
            list.push(decl);
            if (!is(',')) break;
            next();
        }
        expect(';');
        return list;
    }

    function topLevel() {
        const items = [];
        while (peek().kind !== 'eof') {
            if (!isType()) fail(peek(), 'err.parse.topLevel');
            const typeTok = peek();
            const type = typeSpec();
            if (peek().kind === 'ident' && is('(', 1)) items.push(funcDef(type, typeTok));
            else items.push(...declarators(type, true, typeTok));
        }
        return items;
    }

    function funcDef(retType, typeTok) {
        const nameTok = next();
        expect('(');
        const params = [];
        if (is('void') && is(')', 1)) next();
        else if (!is(')')) {
            for (;;) {
                if (!isType()) fail(peek(), 'err.parse.paramType');
                const ptok = peek();
                const type = typeSpec();
                const nt = ident();
                let isArray = false;
                if (is('[')) { next(); expect(']'); isArray = true; }
                params.push(node('Param', nt, { type: isArray ? { base: type.base, ptr: true } : type, name: nt.text, isArray, typeLine: ptok.line }));
                if (!is(',')) break;
                next();
            }
        }
        expect(')');
        const fn = node('Func', nameTok, { retType, name: nameTok.text, params, body: null, startLine: typeTok.line });
        if (is(';')) next();
        else fn.body = block();
        return fn;
    }

    // Comandos -------------------------------------------------------------------------------------------------

    function block() {
        const open = expect('{');
        const b = node('Block', open, { items: [] });
        while (!is('}')) {
            if (peek().kind === 'eof') fail(peek(), 'err.parse.expected', { what: '}' });
            if (isType()) {
                const tt = peek();
                b.items.push(...declarators(typeSpec(), false, tt));
            } else b.items.push(statement());
        }
        b.endLine = next().line;
        return b;
    }

    function statement() {
        const tok = peek();
        if (is('{')) return block();
        if (tok.kind === 'keyword') {
            switch (tok.text) {
                case 'if': {
                    next(); expect('(');
                    const cond = expression();
                    expect(')');
                    const n = node('If', tok, { cond, then: statement(), else: null });
                    if (is('else') && peek().kind === 'keyword') { next(); n.else = statement(); }
                    return n;
                }
                case 'while': {
                    next(); expect('(');
                    const cond = expression();
                    expect(')');
                    return node('While', tok, { cond, body: statement() });
                }
                case 'for': {
                    next(); expect('(');
                    let init = null;
                    if (isType()) {
                        const tt = peek();
                        init = declarators(typeSpec(), false, tt);
                    } else if (!is(';')) {
                        const et = peek();
                        init = node('ExprStmt', et, { expr: expression() });
                        expect(';');
                    } else next();
                    const cond = is(';') ? null : expression();
                    expect(';');
                    const step = is(')') ? null : expression();
                    expect(')');
                    return node('For', tok, { init, cond, step, body: statement() });
                }
                case 'return': {
                    next();
                    const value = is(';') ? null : expression();
                    expect(';');
                    return node('Return', tok, { value });
                }
                case 'break': next(); expect(';'); return node('Break', tok);
                case 'continue': next(); expect(';'); return node('Continue', tok);
                case 'else': fail(tok, 'err.parse.else'); break;
                default: break;
            }
        }
        if (is(';')) { next(); return node('Empty', tok); }
        const expr = expression();
        expect(';');
        return node('ExprStmt', tok, { expr });
    }

    // Expressões -----------------------------------------------------------------------------------------------

    function expression() {
        return assignment();
    }

    function assignment() {
        const left = binary(0);
        if (ASSIGN_OPS.has(peek().text) && peek().kind === 'op') {
            const op = next();
            const value = assignment();
            return node('Assign', op, { op: op.text, target: left, value });
        }
        return left;
    }

    function binary(level) {
        if (level >= BINARY_LEVELS.length) return unary();
        let left = binary(level + 1);
        while (peek().kind === 'op' && BINARY_LEVELS[level].includes(peek().text)) {
            const op = next();
            const right = binary(level + 1);
            left = node(op.text === '&&' || op.text === '||' ? 'Logical' : 'Binary', op, { op: op.text, left, right });
        }
        return left;
    }

    function unary() {
        const tok = peek();
        if (tok.kind === 'op' && ['-', '!', '~', '&', '*', '+'].includes(tok.text)) {
            next();
            const operand = unary();
            if (tok.text === '+') return operand;
            return node('Unary', tok, { op: tok.text, operand });
        }
        if (tok.kind === 'op' && (tok.text === '++' || tok.text === '--')) {
            next();
            return node('IncDec', tok, { op: tok.text, prefix: true, target: unary() });
        }
        return postfix();
    }

    function postfix() {
        let e = primary();
        for (;;) {
            if (is('[')) {
                const tok = next();
                const index = expression();
                expect(']');
                e = node('Index', tok, { base: e, index });
            } else if (is('(')) {
                const tok = next();
                if (e.kind !== 'Ident') fail(tok, 'err.parse.call');
                const args = [];
                if (!is(')')) {
                    args.push(assignment());
                    while (is(',')) { next(); args.push(assignment()); }
                }
                expect(')');
                e = node('Call', tok, { name: e.name, nameNode: e, args });
            } else if (peek().kind === 'op' && (peek().text === '++' || peek().text === '--')) {
                const tok = next();
                e = node('IncDec', tok, { op: tok.text, prefix: false, target: e });
            } else return e;
        }
    }

    function primary() {
        const tok = peek();
        if (tok.kind === 'int') { next(); return node('IntLit', tok, { value: tok.value }); }
        if (tok.kind === 'float') { next(); return node('FloatLit', tok, { value: tok.value }); }
        if (tok.kind === 'ident') { next(); return node('Ident', tok, { name: tok.text }); }
        if (is('(')) {
            next();
            const e = expression();
            expect(')');
            return e;
        }
        fail(tok, 'err.parse.expr');
        return null;
    }

    try {
        const first = peek();
        const items = topLevel();
        const ast = { kind: 'Program', id: -1, line: first.line, col: first.col, items };
        return { ast, nodes, errors: [] };
    } catch (e) {
        if (!(e instanceof ParseError)) throw e;
        return { ast: null, nodes, errors: [{ line: e.line, col: e.col, message: e.message }] };
    }
}

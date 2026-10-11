/**
 * Análise semântica do MiniC: tabela de símbolos com escopos aninhados e verificação de tipos.
 *
 * Percorre a árvore uma vez. Cada declaração cria um símbolo no escopo atual (global, da função ou de um bloco);
 * cada uso de nome procura o símbolo do escopo mais interno para o mais externo. Cada expressão recebe o tipo
 * (n.ty) e a indicação de lvalue (n.lvalue, quando pode receber atribuição ou ter o endereço tomado). As
 * conversões implícitas (int para float e o contrário, vetor para ponteiro) ficam para a geração da IR, que
 * consulta os tipos anotados aqui.
 */
import { t } from '../i18n/index.js';
import { INT, FLOAT, VOID, ERROR, ptr, array, fromSpec, isNum, isScalar, isErr, decay, same, str } from './types.js';

/**
 * @param {object} ast saída de parse()
 * @returns {{errors: Array, warnings: Array, scopes: object, symbols: object[], functions: Map}}
 */
export function analyze(ast) {
    const errors = [], warnings = [];
    const symbols = [];
    const functions = new Map();
    const root = { kind: 'global', name: null, line: 1, symbols: [], children: [], parent: null };
    let scope = root, fn = null, loops = 0;

    const err = (n, key, params = {}) => { errors.push({ line: n.line, col: n.col, message: t(key, params) }); return ERROR; };
    const lookup = (name) => {
        for (let s = scope; s; s = s.parent) {
            const sym = s.symbols.find((x) => x.name === name);
            if (sym) return sym;
        }
        return null;
    };
    const declare = (n, sym) => {
        if (scope.symbols.some((x) => x.name === sym.name)) {
            err(n, 'err.sema.redeclared', { name: sym.name });
            return null;
        }
        sym.id = symbols.length;
        sym.scope = scope;
        scope.symbols.push(sym);
        symbols.push(sym);
        n.sym = sym;
        return sym;
    };
    const enter = (kind, name, line) => {
        const s = { kind, name, line, symbols: [], children: [], parent: scope };
        scope.children.push(s);
        scope = s;
    };
    const leave = () => { scope = scope.parent; };

    /** Se um valor do tipo `from` pode ser atribuído a `to` (com as conversões implícitas do C). */
    function assignable(to, from, node) {
        if (isErr(to) || isErr(from)) return true;
        const f = decay(from);
        if (isNum(to) && isNum(f)) return true;
        if (to.k === 'ptr' && f.k === 'ptr') return to.to === f.to;
        if (to.k === 'ptr' && node && node.kind === 'IntLit' && node.value === 0) return true;
        return false;
    }

    // Expressões -----------------------------------------------------------------------------------------------

    function expr(n) {
        n.ty = exprType(n);
        return n.ty;
    }

    function exprType(n) {
        switch (n.kind) {
            case 'IntLit': return INT;
            case 'FloatLit': return FLOAT;
            case 'Ident': {
                const sym = lookup(n.name);
                if (!sym) return err(n, 'err.sema.undeclared', { name: n.name });
                if (sym.kind === 'func') return err(n, 'err.sema.funcAsVar', { name: n.name });
                n.sym = sym;
                sym.uses++;
                n.lvalue = sym.type.k !== 'array';
                return sym.type;
            }
            case 'Index': {
                const b = decay(expr(n.base));
                const i = expr(n.index);
                if (isErr(b) || isErr(i)) return ERROR;
                if (b.k !== 'ptr') return err(n, 'err.sema.notIndexable', { type: str(b) });
                if (i.k !== 'int') return err(n.index, 'err.sema.indexInt', { type: str(i) });
                n.lvalue = true;
                return b.to === 'int' ? INT : FLOAT;
            }
            case 'Call': {
                const f = functions.get(n.name);
                if (!f) {
                    const sym = lookup(n.name);
                    for (const a of n.args) expr(a);
                    return err(n, sym ? 'err.sema.notFunction' : 'err.sema.undeclaredFn', { name: n.name });
                }
                n.fn = f;
                f.calls++;
                if (n.args.length !== f.params.length)
                    err(n, 'err.sema.argCount', { name: n.name, n: f.params.length, got: n.args.length });
                n.args.forEach((a, k) => {
                    const at = expr(a);
                    const pt = f.params[k]?.type;
                    if (pt && !assignable(pt, at, a)) err(a, 'err.sema.argType', { k: k + 1, name: n.name, want: str(pt), got: str(decay(at)) });
                });
                return f.ret;
            }
            case 'Unary': {
                const o = expr(n.operand);
                if (isErr(o)) return ERROR;
                switch (n.op) {
                    case '-': return isNum(o) ? o : err(n, 'err.sema.unary', { op: n.op, type: str(o) });
                    case '!': return isScalar(decay(o)) ? INT : err(n, 'err.sema.unary', { op: n.op, type: str(o) });
                    case '~': return o.k === 'int' ? INT : err(n, 'err.sema.unary', { op: n.op, type: str(o) });
                    case '&':
                        if (!n.operand.lvalue) return err(n, o.k === 'array' ? 'err.sema.addrArray' : 'err.sema.addrOf');
                        if (o.k === 'ptr') return err(n, 'err.sema.ptrptr');
                        return ptr(o.k);
                    case '*': {
                        const d = decay(o);
                        if (d.k !== 'ptr') return err(n, 'err.sema.deref', { type: str(o) });
                        n.lvalue = true;
                        return d.to === 'int' ? INT : FLOAT;
                    }
                    default: return ERROR;
                }
            }
            case 'IncDec': {
                const o = expr(n.target);
                if (isErr(o)) return ERROR;
                if (!n.target.lvalue) return err(n, 'err.sema.lvalue', { op: n.op });
                if (!isScalar(o)) return err(n, 'err.sema.unary', { op: n.op, type: str(o) });
                return o;
            }
            case 'Logical': {
                const a = decay(expr(n.left)), b = decay(expr(n.right));
                if (isErr(a) || isErr(b)) return ERROR;
                if (!isScalar(a) || !isScalar(b)) return err(n, 'err.sema.binary', { op: n.op, a: str(a), b: str(b) });
                return INT;
            }
            case 'Binary': return binaryType(n, n.op, decay(expr(n.left)), decay(expr(n.right)));
            case 'Assign': {
                const tt = expr(n.target);
                const vt = expr(n.value);
                if (isErr(tt) || isErr(vt)) return ERROR;
                if (!n.target.lvalue) return err(n, tt.k === 'array' ? 'err.sema.assignArray' : 'err.sema.lvalue', { op: n.op });
                if (n.op === '=') {
                    if (!assignable(tt, vt, n.value)) return err(n, 'err.sema.assignType', { want: str(tt), got: str(decay(vt)) });
                } else {
                    const r = binaryType(n, n.op.slice(0, -1), tt, decay(vt));
                    if (isErr(r)) return ERROR;
                    if (!assignable(tt, r)) return err(n, 'err.sema.assignType', { want: str(tt), got: str(r) });
                }
                return tt;
            }
            default: return err(n, 'err.sema.unknown');
        }
    }

    /** Tipo do resultado de um operador binário (operandos já convertidos de vetor para ponteiro). */
    function binaryType(n, op, a, b) {
        if (isErr(a) || isErr(b)) return ERROR;
        const bad = () => err(n, 'err.sema.binary', { op, a: str(a), b: str(b) });
        if (['+', '-'].includes(op)) {
            if (isNum(a) && isNum(b)) return a.k === 'float' || b.k === 'float' ? FLOAT : INT;
            if (a.k === 'ptr' && b.k === 'int') return a;
            if (op === '+' && a.k === 'int' && b.k === 'ptr') return b;
            if (op === '-' && a.k === 'ptr' && b.k === 'ptr' && a.to === b.to) return INT;
            return bad();
        }
        if (['*', '/'].includes(op)) {
            if (isNum(a) && isNum(b)) return a.k === 'float' || b.k === 'float' ? FLOAT : INT;
            return bad();
        }
        if (['%', '&', '|', '^', '<<', '>>'].includes(op)) return a.k === 'int' && b.k === 'int' ? INT : bad();
        if (['<', '<=', '>', '>=', '==', '!='].includes(op)) {
            if (isNum(a) && isNum(b)) return INT;
            if (a.k === 'ptr' && b.k === 'ptr' && a.to === b.to) return INT;
            return bad();
        }
        return bad();
    }

    /** Condição de if, while e for: precisa ser escalar. */
    function cond(n) {
        const c = decay(expr(n));
        if (!isErr(c) && !isScalar(c)) err(n, 'err.sema.cond', { type: str(c) });
    }

    // Declarações e comandos -----------------------------------------------------------------------------------

    function isConst(n) {
        if (n.kind === 'IntLit' || n.kind === 'FloatLit') return true;
        return n.kind === 'Unary' && n.op === '-' && (n.operand.kind === 'IntLit' || n.operand.kind === 'FloatLit');
    }

    function varDecl(n) {
        const base = fromSpec(n.type);
        if (base.k === 'void') { err(n, 'err.sema.voidVar', { name: n.name }); return; }
        let type = base;
        if (n.arrayLen !== null) {
            if (base.k === 'ptr') { err(n, 'err.sema.ptrArray'); return; }
            if (n.arrayLen <= 0) { err(n, 'err.sema.arraySize'); return; }
            type = array(base.k, n.arrayLen);
        }
        const sym = { name: n.name, kind: n.global ? 'global' : 'local', type, line: n.line, uses: 0, node: n };
        if (n.init) {
            if (n.init.kind === 'InitList') {
                if (type.k !== 'array') err(n.init, 'err.sema.initList', { name: n.name });
                else if (n.init.items.length > type.len) err(n.init, 'err.sema.initTooMany', { name: n.name, n: type.len });
                for (const it of n.init.items) {
                    const it2 = expr(it);
                    if (n.global && !isConst(it)) err(it, 'err.sema.globalInit');
                    else if (type.k === 'array' && !isNum(it2) && !isErr(it2)) err(it, 'err.sema.assignType', { want: type.of, got: str(it2) });
                }
            } else {
                if (type.k === 'array') err(n.init, 'err.sema.arrayInit', { name: n.name });
                const it = expr(n.init);
                if (n.global && !isConst(n.init)) err(n.init, 'err.sema.globalInit');
                else if (type.k !== 'array' && !assignable(type, it, n.init)) err(n.init, 'err.sema.assignType', { want: str(type), got: str(decay(it)) });
            }
        }
        declare(n, sym);
        if (fn && sym) fn.locals.push(sym);
    }

    function statement(n) {
        switch (n.kind) {
            case 'VarDecl': varDecl(n); break;
            case 'Block':
                enter('block', null, n.line);
                n.scope = scope;
                for (const it of n.items) statement(it);
                leave();
                break;
            case 'ExprStmt': expr(n.expr); break;
            case 'If': cond(n.cond); statement(n.then); if (n.else) statement(n.else); break;
            case 'While': cond(n.cond); loops++; statement(n.body); loops--; break;
            case 'For':
                enter('block', 'for', n.line);
                if (Array.isArray(n.init)) for (const d of n.init) varDecl(d);
                else if (n.init) expr(n.init.expr);
                if (n.cond) cond(n.cond);
                if (n.step) expr(n.step);
                loops++;
                statement(n.body);
                loops--;
                leave();
                break;
            case 'Return': {
                if (n.value) {
                    const vt = expr(n.value);
                    if (fn.ret.k === 'void') err(n, 'err.sema.returnVoid', { name: fn.name });
                    else if (!assignable(fn.ret, vt, n.value)) err(n, 'err.sema.returnType', { want: str(fn.ret), got: str(decay(vt)) });
                } else if (fn.ret.k !== 'void') err(n, 'err.sema.returnValue', { name: fn.name, type: str(fn.ret) });
                break;
            }
            case 'Break': case 'Continue':
                if (loops === 0) err(n, 'err.sema.loopOnly', { what: n.kind === 'Break' ? 'break' : 'continue' });
                break;
            case 'Empty': break;
            default: err(n, 'err.sema.unknown');
        }
    }

    function funcDecl(n) {
        const ret = fromSpec(n.retType);
        const params = n.params.map((p) => ({ name: p.name, type: fromSpec(p.type), node: p }));
        for (const p of params) if (p.type.k === 'void') err(p.node, 'err.sema.voidVar', { name: p.name });
        if (params.length > 8) err(n, 'err.sema.tooManyParams', { name: n.name });
        let f = functions.get(n.name);
        if (f) {
            const sameSig = same(f.ret, ret) && f.params.length === params.length && f.params.every((p, k) => same(p.type, params[k].type));
            if (!sameSig) err(n, 'err.sema.signature', { name: n.name });
            if (f.defined && n.body) err(n, 'err.sema.redefined', { name: n.name });
        } else {
            if (scope.symbols.some((x) => x.name === n.name)) err(n, 'err.sema.redeclared', { name: n.name });
            f = { name: n.name, ret, params, defined: false, calls: 0, locals: [], node: n, line: n.line };
            functions.set(n.name, f);
            const sym = { name: n.name, kind: 'func', type: ret, line: n.line, uses: 0, fn: f, node: n };
            sym.id = symbols.length;
            sym.scope = scope;
            scope.symbols.push(sym);
            symbols.push(sym);
        }
        n.fn = f;
        if (!n.body) return;
        f.defined = true;
        f.node = n;
        fn = f;
        enter('function', n.name, n.line);
        n.scope = scope;
        f.paramSyms = n.params.map((p, k) => declare(p, { name: p.name, kind: 'param', type: params[k].type, line: p.line, uses: 0, node: p, index: k }));
        enter('block', null, n.body.line);
        n.body.scope = scope;
        for (const it of n.body.items) statement(it);
        leave();
        leave();
        fn = null;
    }

    for (const it of ast.items) {
        if (it.kind === 'Func') funcDecl(it);
        else varDecl(it);
    }
    for (const f of functions.values()) if (!f.defined && f.calls > 0) errors.push({ line: f.line, col: 1, message: t('err.sema.undefined', { name: f.name }) });
    const main = functions.get('main');
    if (!main) errors.push({ line: 1, col: 1, message: t('err.sema.noMain') });
    else if (main.params.length > 0 || main.ret.k === 'void' || main.ret.k === 'ptr') errors.push({ line: main.line, col: 1, message: t('err.sema.mainSig') });
    for (const s of symbols) if ((s.kind === 'local') && s.uses === 0) warnings.push({ line: s.line, col: 1, message: t('warn.unused', { name: s.name }) });
    return { errors, warnings, scopes: root, symbols, functions };
}

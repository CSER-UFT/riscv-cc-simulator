/**
 * Geração da representação intermediária (IR) no formato do LLVM, como o clang faz sem otimização (-O0):
 * cada variável local e cada parâmetro ficam na memória (alloca), lidos com load e escritos com store; as
 * expressões viram instruções de três endereços com tipo (add i32, fmul float, icmp slt, getelementptr...),
 * e o controle vira blocos básicos ligados por br. Os operadores && e || usam blocos e uma função phi, como
 * no clang. A passagem mem2reg (etapa seguinte do simulador) é que promove as variáveis para registradores.
 *
 * Cada instrução guarda a linha do código fonte e o nó da árvore que a gerou, para o destaque entre as fases.
 */
import { INT, FLOAT, decay, irType, elemIr, size } from './types.js';

const ICMP = { '<': 'slt', '<=': 'sle', '>': 'sgt', '>=': 'sge', '==': 'eq', '!=': 'ne' };
const ICMP_PTR = { '<': 'ult', '<=': 'ule', '>': 'ugt', '>=': 'uge', '==': 'eq', '!=': 'ne' };
const FCMP = { '<': 'olt', '<=': 'ole', '>': 'ogt', '>=': 'oge', '==': 'oeq', '!=': 'une' };
const IBIN = { '+': 'add', '-': 'sub', '*': 'mul', '/': 'sdiv', '%': 'srem', '&': 'and', '|': 'or', '^': 'xor', '<<': 'shl', '>>': 'ashr' };
const FBIN = { '+': 'fadd', '-': 'fsub', '*': 'fmul', '/': 'fdiv' };

export const cInt = (v) => ({ vk: 'const', ty: 'i32', v: v | 0 });
export const cFloat = (v) => ({ vk: 'const', ty: 'float', v: Math.fround(v) });
export const cBool = (v) => ({ vk: 'const', ty: 'i1', v: v ? 1 : 0 });
export const cNull = () => ({ vk: 'const', ty: 'ptr', v: 0 });

/**
 * @param {object} ast árvore anotada pela análise semântica
 * @param {object} sema resultado de analyze()
 */
export function generateIR(ast, sema) {
    const module = { globals: [], functions: [] };
    for (const it of ast.items) {
        if (it.kind === 'VarDecl') module.globals.push(globalVar(it));
        else if (it.body) module.functions.push(genFunction(it, sema));
    }
    return module;
}

function constValue(n) {
    if (n.kind === 'IntLit' || n.kind === 'FloatLit') return n.value;
    if (n.kind === 'Unary' && n.op === '-') return -constValue(n.operand);
    return 0;
}

function globalVar(n) {
    const sym = n.sym;
    sym.addr = { vk: 'global', ty: 'ptr', name: sym.name };
    const ty = sym.type;
    const elem = ty.k === 'array' ? ty.of : ty.k;
    let values = null;
    if (n.init) {
        const items = n.init.kind === 'InitList' ? n.init.items : [n.init];
        values = items.map(constValue).map((v) => (elem === 'int' ? Math.trunc(v) | 0 : Math.fround(v)));
    }
    return { name: sym.name, type: ty, irTy: irType(ty), elem, values, line: n.line, sym };
}

function genFunction(fnNode, sema) {
    const f = fnNode.fn;
    const F = {
        name: f.name, retTy: irType(f.ret), ret: f.ret, params: [], blocks: [], allocas: [], line: fnNode.line,
        endLine: fnNode.body.endLine ?? fnNode.line, sym: f,
    };
    const labelCount = new Map();
    const usedNames = new Set();
    const uniqueName = (base) => {
        let name = base, k = 1;
        while (usedNames.has(name)) name = `${base}${k++}`;
        usedNames.add(name);
        return name;
    };
    let cur = null;
    let line = fnNode.line, nodeId = fnNode.id;
    const loopStack = [];

    const newBlock = (base) => {
        const n = labelCount.get(base) ?? 0;
        labelCount.set(base, n + 1);
        return { label: n === 0 ? base : `${base}${n + 1}`, insts: [], preds: [] };
    };
    // Como no clang, o bloco entra na função quando começa a ser preenchido: a ordem do texto segue o código.
    const setBlock = (b) => {
        if (!F.blocks.includes(b)) F.blocks.push(b);
        cur = b;
    };
    const terminated = () => cur.insts.length > 0 && ['br', 'condbr', 'ret'].includes(cur.insts[cur.insts.length - 1].op);
    const temp = (ty) => ({ vk: 'temp', ty, name: null });
    const emit = (inst) => {
        if (terminated()) setBlock(newBlock('dead'));
        inst.line = line;
        inst.node = nodeId;
        cur.insts.push(inst);
        return inst.dst ?? null;
    };
    const at = (n, fnc) => {
        const [l0, n0] = [line, nodeId];
        line = n.line;
        nodeId = n.id;
        const r = fnc();
        line = l0;
        nodeId = n0;
        return r;
    };
    const br = (target) => emit({ op: 'br', target: target.label });
    const condbr = (c, tb, fb) => emit({ op: 'condbr', cond: c, t: tb.label, f: fb.label });

    // Entrada: allocas dos parâmetros e das variáveis locais, e cópia dos parâmetros para a memória.
    setBlock(newBlock('entry'));
    f.paramSyms.forEach((sym, k) => {
        if (!sym) return;
        const ty = irType(sym.type);
        const arg = { vk: 'arg', ty, name: uniqueName(sym.name), sym };
        F.params.push({ name: arg.name, ty, value: arg, sym });
        const addr = { vk: 'temp', ty: 'ptr', name: uniqueName(`${sym.name}.addr`) };
        sym.addr = addr;
        const inst = { op: 'alloca', dst: addr, allocTy: ty, bytes: 4, line: fnNode.line, node: sym.node.id, sym };
        F.allocas.push(inst);
        cur.insts.push(inst);
        void k;
    });
    for (const sym of f.locals) {
        const ty = irType(sym.type);
        const addr = { vk: 'temp', ty: 'ptr', name: uniqueName(sym.name) };
        sym.addr = addr;
        const inst = { op: 'alloca', dst: addr, allocTy: ty, bytes: size(sym.type), line: sym.line, node: sym.node.id, sym };
        F.allocas.push(inst);
        cur.insts.push(inst);
    }
    for (const p of F.params) at(p.sym.node, () => emit({ op: 'store', ty: p.ty, val: p.value, ptr: p.sym.addr }));

    // Conversões ----------------------------------------------------------------------------------------------

    /** Converte um valor do tipo de origem para o de destino (tipos do MiniC). */
    function convert(v, from, to) {
        const f2 = decay(from);
        if (to.k === 'float' && f2.k === 'int') return v.vk === 'const' ? cFloat(v.v) : emit({ op: 'sitofp', dst: temp('float'), a: v });
        if (to.k === 'int' && f2.k === 'float') return v.vk === 'const' ? cInt(Math.trunc(v.v)) : emit({ op: 'fptosi', dst: temp('i32'), a: v });
        if (to.k === 'ptr' && v.vk === 'const' && v.ty === 'i32') return cNull();
        return v;
    }

    /** Condição como i1. */
    function condValue(e) {
        if (e.kind === 'Binary' && ICMP[e.op]) return compare(e);
        if (e.kind === 'Logical') return logical(e);
        if (e.kind === 'Unary' && e.op === '!') {
            const v = condValue(e.operand);
            return at(e, () => emit({ op: 'xor', dst: temp('i1'), ty: 'i1', a: v, b: cBool(true) }));
        }
        const v = rvalue(e);
        const ty = decay(e.ty);
        return at(e, () => {
            if (ty.k === 'float') return emit({ op: 'fcmp', cond: 'une', dst: temp('i1'), a: v, b: cFloat(0) });
            if (ty.k === 'ptr') return emit({ op: 'icmp', cond: 'ne', ty: 'ptr', dst: temp('i1'), a: v, b: cNull() });
            return emit({ op: 'icmp', cond: 'ne', ty: 'i32', dst: temp('i1'), a: v, b: cInt(0) });
        });
    }

    function compare(e) {
        const lt = decay(e.left.ty), rt = decay(e.right.ty);
        let a = rvalue(e.left), b = rvalue(e.right);
        return at(e, () => {
            if (lt.k === 'ptr') return emit({ op: 'icmp', cond: ICMP_PTR[e.op], ty: 'ptr', dst: temp('i1'), a, b });
            if (lt.k === 'float' || rt.k === 'float') {
                a = convert(a, lt, FLOAT);
                b = convert(b, rt, FLOAT);
                return emit({ op: 'fcmp', cond: FCMP[e.op], dst: temp('i1'), a, b });
            }
            return emit({ op: 'icmp', cond: ICMP[e.op], ty: 'i32', dst: temp('i1'), a, b });
        });
    }

    /** && e ||: avaliação em curto circuito com uma phi no bloco de junção. */
    function logical(e) {
        const isAnd = e.op === '&&';
        const l = condValue(e.left);
        return at(e, () => {
            const rhs = newBlock(isAnd ? 'land.rhs' : 'lor.rhs');
            const end = newBlock(isAnd ? 'land.end' : 'lor.end');
            const from = cur;
            if (isAnd) condbr(l, rhs, end); else condbr(l, end, rhs);
            setBlock(rhs);
            const r = condValue(e.right);
            const rhsEnd = cur;
            br(end);
            setBlock(end);
            return emit({ op: 'phi', ty: 'i1', dst: temp('i1'), incoming: [[cBool(!isAnd), from.label], [r, rhsEnd.label]] });
        });
    }

    // Endereços e valores -------------------------------------------------------------------------------------

    /** Endereço de um lvalue (ou de um vetor). */
    function address(e) {
        switch (e.kind) {
            case 'Ident': return e.sym.addr;
            case 'Index': {
                const base = rvalue(e.base);
                const idx = rvalue(e.index);
                const elem = decay(e.base.ty).to;
                return at(e, () => emit({ op: 'gep', dst: temp('ptr'), elem: elemIr(elem), base, index: idx }));
            }
            case 'Unary': return rvalue(e.operand);
            default: throw new Error(`address(${e.kind})`);
        }
    }

    function load(e, addr) {
        return at(e, () => emit({ op: 'load', dst: temp(irType(e.ty)), ty: irType(e.ty), ptr: addr }));
    }

    function rvalue(e) {
        switch (e.kind) {
            case 'IntLit': return cInt(e.value);
            case 'FloatLit': return cFloat(e.value);
            case 'Ident':
                if (e.ty.k === 'array') return e.sym.addr;
                return load(e, e.sym.addr);
            case 'Index': return load(e, address(e));
            case 'Unary': {
                if (e.op === '&') return address(e.operand);
                if (e.op === '*') return load(e, rvalue(e.operand));
                if (e.op === '!') {
                    const c = condValue(e.operand);
                    return at(e, () => {
                        const n = emit({ op: 'xor', dst: temp('i1'), ty: 'i1', a: c, b: cBool(true) });
                        return emit({ op: 'zext', dst: temp('i32'), a: n });
                    });
                }
                const v = rvalue(e.operand);
                return at(e, () => {
                    if (e.op === '-') {
                        if (e.ty.k === 'float') return v.vk === 'const' ? cFloat(-v.v) : emit({ op: 'fneg', dst: temp('float'), a: v });
                        return v.vk === 'const' ? cInt(-v.v) : emit({ op: 'sub', dst: temp('i32'), ty: 'i32', a: cInt(0), b: v });
                    }
                    return emit({ op: 'xor', dst: temp('i32'), ty: 'i32', a: v, b: cInt(-1) });
                });
            }
            case 'Binary':
                if (ICMP[e.op]) {
                    const c = compare(e);
                    return at(e, () => emit({ op: 'zext', dst: temp('i32'), a: c }));
                }
                return arith(e, e.op, rvalue(e.left), decay(e.left.ty), rvalue(e.right), decay(e.right.ty), e.ty);
            case 'Logical': {
                const c = logical(e);
                return at(e, () => emit({ op: 'zext', dst: temp('i32'), a: c }));
            }
            case 'Assign': return assign(e);
            case 'IncDec': return incdec(e);
            case 'Call': return call(e);
            default: throw new Error(`rvalue(${e.kind})`);
        }
    }

    /** Operação aritmética entre dois valores, com as conversões e a aritmética de ponteiros. */
    function arith(e, op, a, at0, b, bt, rt) {
        return at(e, () => {
            if (at0.k === 'ptr' && bt.k === 'ptr') {
                const ia = emit({ op: 'ptrtoint', dst: temp('i32'), a });
                const ib = emit({ op: 'ptrtoint', dst: temp('i32'), a: b });
                const d = emit({ op: 'sub', dst: temp('i32'), ty: 'i32', a: ia, b: ib });
                return emit({ op: 'sdiv', dst: temp('i32'), ty: 'i32', a: d, b: cInt(4), exact: true });
            }
            if (at0.k === 'ptr' || bt.k === 'ptr') {
                const [p, i, pt] = at0.k === 'ptr' ? [a, b, at0] : [b, a, bt];
                let idx = i;
                if (op === '-') idx = idx.vk === 'const' ? cInt(-idx.v) : emit({ op: 'sub', dst: temp('i32'), ty: 'i32', a: cInt(0), b: idx });
                return emit({ op: 'gep', dst: temp('ptr'), elem: elemIr(pt.to), base: p, index: idx });
            }
            if (rt.k === 'float') {
                const fa = convert(a, at0, FLOAT), fb = convert(b, bt, FLOAT);
                return emit({ op: FBIN[op], dst: temp('float'), ty: 'float', a: fa, b: fb });
            }
            return emit({ op: IBIN[op], dst: temp('i32'), ty: 'i32', a, b });
        });
    }

    function assign(e) {
        const tt = e.target.ty;
        if (e.op === '=') {
            const v = convert(rvalue(e.value), e.value.ty, tt);
            const addr = address(e.target);
            at(e, () => emit({ op: 'store', ty: irType(tt), val: v, ptr: addr }));
            return v;
        }
        const op = e.op.slice(0, -1);
        const addr = address(e.target);
        const old = load(e.target, addr);
        const rv = rvalue(e.value);
        const rt = op === '-' && decay(tt).k === 'ptr' ? tt : resultType(op, decay(tt), decay(e.value.ty));
        const r = arith(e, op, old, decay(tt), rv, decay(e.value.ty), rt);
        const v = at(e, () => convert(r, rt, tt));
        at(e, () => emit({ op: 'store', ty: irType(tt), val: v, ptr: addr }));
        return v;
    }

    function resultType(op, a, b) {
        if (a.k === 'ptr') return a;
        if (['%', '&', '|', '^', '<<', '>>'].includes(op)) return INT;
        return a.k === 'float' || b.k === 'float' ? FLOAT : INT;
    }

    function incdec(e) {
        const tt = e.target.ty;
        const addr = address(e.target);
        const old = load(e.target, addr);
        return at(e, () => {
            const up = e.op === '++';
            let nv;
            if (tt.k === 'ptr') nv = emit({ op: 'gep', dst: temp('ptr'), elem: elemIr(tt.to), base: old, index: cInt(up ? 1 : -1) });
            else if (tt.k === 'float') nv = emit({ op: up ? 'fadd' : 'fsub', dst: temp('float'), ty: 'float', a: old, b: cFloat(1) });
            else nv = emit({ op: up ? 'add' : 'sub', dst: temp('i32'), ty: 'i32', a: old, b: cInt(1) });
            emit({ op: 'store', ty: irType(tt), val: nv, ptr: addr });
            return e.prefix ? nv : old;
        });
    }

    function call(e) {
        const fnInfo = e.fn;
        const args = e.args.map((a, k) => {
            const pt = fnInfo.params[k].type;
            const v = convert(rvalue(a), a.ty, pt);
            return { ty: irType(pt), val: v };
        });
        return at(e, () => emit({
            op: 'call', fn: fnInfo.name, retTy: irType(fnInfo.ret), args,
            dst: fnInfo.ret.k === 'void' ? null : temp(irType(fnInfo.ret)),
        }));
    }

    // Comandos ---------------------------------------------------------------------------------------------------

    function statement(s) {
        switch (s.kind) {
            case 'Block': for (const it of s.items) statement(it); break;
            case 'VarDecl':
                if (s.init) {
                    if (s.init.kind === 'InitList') {
                        const elem = s.sym.type.of;
                        const target = { kind: 'VarDecl', ty: s.sym.type.of === 'int' ? INT : FLOAT };
                        s.init.items.forEach((it, k) => {
                            const v = convert(rvalue(it), it.ty, target.ty);
                            at(it, () => {
                                const p = emit({ op: 'gep', dst: temp('ptr'), elem: elemIr(elem), base: s.sym.addr, index: cInt(k) });
                                emit({ op: 'store', ty: elemIr(elem), val: v, ptr: p });
                            });
                        });
                    } else {
                        const v = convert(rvalue(s.init), s.init.ty, s.sym.type);
                        at(s, () => emit({ op: 'store', ty: irType(s.sym.type), val: v, ptr: s.sym.addr }));
                    }
                }
                break;
            case 'ExprStmt': rvalueStmt(s.expr); break;
            case 'If': at(s, () => {
                const c = condValue(s.cond);
                const thenB = newBlock('if.then');
                const elseB = s.else ? newBlock('if.else') : null;
                const end = newBlock('if.end');
                condbr(c, thenB, elseB ?? end);
                setBlock(thenB);
                statement(s.then);
                br(end);
                if (elseB) {
                    setBlock(elseB);
                    statement(s.else);
                    br(end);
                }
                setBlock(end);
            }); break;
            case 'While': at(s, () => {
                const condB = newBlock('while.cond');
                const body = newBlock('while.body');
                const end = newBlock('while.end');
                br(condB);
                setBlock(condB);
                condbr(condValue(s.cond), body, end);
                setBlock(body);
                loopStack.push({ brk: end, cont: condB });
                statement(s.body);
                loopStack.pop();
                br(condB);
                setBlock(end);
            }); break;
            case 'For': at(s, () => {
                if (Array.isArray(s.init)) for (const d of s.init) statement(d);
                else if (s.init) rvalueStmt(s.init.expr);
                const condB = newBlock('for.cond');
                const body = newBlock('for.body');
                const inc = newBlock('for.inc');
                const end = newBlock('for.end');
                br(condB);
                setBlock(condB);
                if (s.cond) condbr(condValue(s.cond), body, end); else br(body);
                setBlock(body);
                loopStack.push({ brk: end, cont: inc });
                statement(s.body);
                loopStack.pop();
                br(inc);
                setBlock(inc);
                if (s.step) rvalueStmt(s.step);
                br(condB);
                setBlock(end);
            }); break;
            case 'Return': at(s, () => {
                if (s.value) emit({ op: 'ret', ty: F.retTy, val: convert(rvalue(s.value), s.value.ty, f.ret) });
                else emit({ op: 'ret', ty: 'void', val: null });
            }); break;
            case 'Break': at(s, () => br(loopStack[loopStack.length - 1].brk)); break;
            case 'Continue': at(s, () => br(loopStack[loopStack.length - 1].cont)); break;
            case 'Empty': break;
            default: break;
        }
    }

    function rvalueStmt(e) {
        rvalue(e);
    }

    statement(fnNode.body);
    line = F.endLine;
    nodeId = fnNode.id;
    if (!terminated()) {
        if (f.ret.k === 'void') emit({ op: 'ret', ty: 'void', val: null });
        else emit({ op: 'ret', ty: F.retTy, val: f.ret.k === 'float' ? cFloat(0) : cInt(0) });
    }
    cleanup(F);
    return F;
}

/** Remove blocos inalcançáveis (como os criados depois de return ou break) e calcula os predecessores. */
function cleanup(F) {
    const byLabel = new Map(F.blocks.map((b) => [b.label, b]));
    const succ = (b) => {
        const term = b.insts[b.insts.length - 1];
        if (!term) return [];
        if (term.op === 'br') return [term.target];
        if (term.op === 'condbr') return [term.t, term.f];
        return [];
    };
    const reach = new Set(['entry']);
    const work = ['entry'];
    while (work.length) {
        const b = byLabel.get(work.pop());
        for (const s of succ(b)) if (!reach.has(s)) { reach.add(s); work.push(s); }
    }
    F.blocks = F.blocks.filter((b) => reach.has(b.label));
    for (const b of F.blocks) {
        // Bloco alcançável sem terminador (não deveria acontecer): termina com ret.
        if (!['br', 'condbr', 'ret'].includes(b.insts[b.insts.length - 1]?.op))
            b.insts.push({ op: 'ret', ty: F.retTy, val: F.retTy === 'void' ? null : F.retTy === 'float' ? cFloat(0) : cInt(0), line: F.endLine, node: -1 });
        b.preds = [];
    }
    for (const b of F.blocks) for (const s of succ(b)) byLabel.get(s).preds.push(b.label);
    // Entradas de phi vindas de blocos removidos.
    for (const b of F.blocks)
        for (const i of b.insts)
            if (i.op === 'phi') i.incoming = i.incoming.filter(([, l]) => reach.has(l));
}

// Impressão no formato textual do LLVM ------------------------------------------------------------------------

/** Constante float no formato do LLVM: decimal quando exata, senão hexadecimal do double. */
function floatText(v) {
    const e = v.toExponential(6).replace(/e([+-])(\d)$/, 'e$10$2');
    if (Math.fround(Number(e)) === v && Number(e) === v) return e;
    const buf = new DataView(new ArrayBuffer(8));
    buf.setFloat64(0, v);
    return `0x${buf.getBigUint64(0).toString(16).toUpperCase().padStart(16, '0')}`;
}

/** Nomeia os temporários sem nome (%0, %1...) na ordem em que aparecem no texto. */
export function numberValues(F) {
    // Os nomes numéricos que já existem (IR importada de um .ll) não podem ser repetidos.
    let n = 0;
    for (const p of F.params) if (/^\d+$/.test(p.name)) n = Math.max(n, Number(p.name) + 1);
    for (const b of F.blocks) {
        if (/^\d+$/.test(b.label)) n = Math.max(n, Number(b.label) + 1);
        for (const i of b.insts) if (i.dst && /^\d+$/.test(i.dst.name ?? '')) n = Math.max(n, Number(i.dst.name) + 1);
    }
    for (const b of F.blocks) for (const i of b.insts) if (i.dst && i.dst.name === null) i.dst.n = n++;
}

export function valueText(v) {
    switch (v.vk) {
        case 'const':
            if (v.ty === 'float') return floatText(v.v);
            if (v.ty === 'i1') return v.v ? 'true' : 'false';
            if (v.ty === 'ptr') return 'null';
            return String(v.v);
        case 'global': return `@${v.name}`;
        case 'undef': return 'undef';
        default: return v.name !== null ? `%${v.name}` : `%${v.n}`;
    }
}

/** Texto de uma instrução da IR. */
export function instText(i) {
    const V = valueText;
    const d = i.dst ? `${V(i.dst)} = ` : '';
    switch (i.op) {
        case 'alloca': return `${d}alloca ${i.allocTy}`;
        case 'load': return `${d}load ${i.ty}, ptr ${V(i.ptr)}`;
        case 'store': return `store ${i.ty} ${V(i.val)}, ptr ${V(i.ptr)}`;
        case 'icmp': return `${d}icmp ${i.cond} ${i.ty} ${V(i.a)}, ${V(i.b)}`;
        case 'fcmp': return `${d}fcmp ${i.cond} float ${V(i.a)}, ${V(i.b)}`;
        case 'zext': return `${d}zext i1 ${V(i.a)} to i32`;
        case 'sitofp': return `${d}sitofp i32 ${V(i.a)} to float`;
        case 'fptosi': return `${d}fptosi float ${V(i.a)} to i32`;
        case 'ptrtoint': return `${d}ptrtoint ptr ${V(i.a)} to i32`;
        case 'fneg': return `${d}fneg float ${V(i.a)}`;
        case 'bitcast': return `${d}bitcast ${i.from} ${V(i.a)} to ${i.to}`;
        case 'gep': return `${d}getelementptr inbounds ${i.elem}, ptr ${V(i.base)}, i32 ${V(i.index)}`;
        case 'br': return `br label %${i.target}`;
        case 'condbr': return `br i1 ${V(i.cond)}, label %${i.t}, label %${i.f}`;
        case 'ret': return i.val ? `ret ${i.ty} ${V(i.val)}` : 'ret void';
        case 'phi': return `${d}phi ${i.ty} ${i.incoming.map(([v, l]) => `[ ${V(v)}, %${l} ]`).join(', ')}`;
        case 'call': return `${d}call ${i.retTy} @${i.fn}(${i.args.map((a) => `${a.ty} ${V(a.val)}`).join(', ')})`;
        default: {
            const ty = i.ty ?? i.dst?.ty;
            const flag = i.exact ? 'exact ' : (['add', 'sub', 'mul', 'shl'].includes(i.op) && ty === 'i32' ? 'nsw ' : '');
            return `${d}${i.op} ${flag}${ty} ${V(i.a)}, ${V(i.b)}`;
        }
    }
}

/**
 * Texto do módulo inteiro, com o mapa linha da IR para (linha do fonte, nó) usado no destaque.
 * @returns {{text: string, lines: Array<{src: number|null, node: number|null, fn?: string, label?: string}>}}
 */
export function printModule(module) {
    const out = [], lines = [];
    const push = (s, src = null, node = null, extra = {}) => { out.push(s); lines.push({ src, node, ...extra }); };
    for (const g of module.globals) {
        let init;
        if (g.type.k === 'ptr') init = 'null';
        else if (g.type.k !== 'array' && (!g.values || g.values[0] === 0)) init = g.elem === 'int' ? '0' : floatText(0);
        else if (!g.values || g.values.every((v) => v === 0)) init = 'zeroinitializer';
        else if (g.type.k === 'array') {
            const ety = g.elem === 'int' ? 'i32' : 'float';
            const all = Array.from({ length: g.type.len }, (_, k) => g.values[k] ?? 0);
            init = `[${all.map((v) => `${ety} ${g.elem === 'int' ? v : floatText(v)}`).join(', ')}]`;
        } else init = g.elem === 'int' ? String(g.values[0]) : floatText(g.values[0]);
        g.irLine = out.length;
        push(`@${g.name} = global ${g.irTy} ${init}`, g.line, g.sym.node.id);
    }
    if (module.globals.length) push('');
    module.functions.forEach((F, k) => {
        numberValues(F);
        if (k > 0) push('');
        push(`define ${F.retTy} @${F.name}(${F.params.map((p) => `${p.ty} %${p.name}`).join(', ')}) {`, F.line, F.sym.node.id, { fn: F.name });
        F.blocks.forEach((b, bi) => {
            if (bi > 0) push('');
            const preds = b.preds.length ? `${' '.repeat(Math.max(1, 40 - b.label.length))}; preds = ${b.preds.map((p) => `%${p}`).join(', ')}` : '';
            push(`${b.label}:${preds}`, null, null, { fn: F.name, label: b.label });
            for (const i of b.insts) {
                i.irLine = out.length;
                push(`  ${instText(i)}`, i.line, i.node, { fn: F.name });
            }
        });
        push('}', F.endLine, null, { fn: F.name });
    });
    return { text: out.join('\n') + '\n', lines };
}

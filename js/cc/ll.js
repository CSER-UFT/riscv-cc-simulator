/**
 * Importação de IR do LLVM em formato textual (.ll), como a gerada por
 *   clang --target=riscv32 -march=rv32imf -mabi=ilp32f -O0 -S -emit-llvm arquivo.c
 *
 * Aceita o mesmo subconjunto que o simulador gera a partir do MiniC: i32, i1, float, ptr e vetores [N x i32] e
 * [N x float]; alloca, load, store, as operações inteiras e de ponto flutuante, icmp, fcmp, zext, sitofp,
 * fptosi, ptrtoint, bitcast, getelementptr com um índice (ou 0 e um índice sobre um vetor), br, ret, phi e
 * call. A chamada llvm.fmuladd.f32, que o clang usa para a*b+c, vira fmul seguida de fadd. Atributos, align,
 * metadados (!...) e grupos de atributos (#0) são ignorados. O que fica fora do subconjunto (double, i64, i8,
 * select, memcpy, structs...) é recusado com uma mensagem que diz a linha e o motivo.
 *
 * Cada instrução guarda a linha do .ll de onde veio, para o destaque entre o texto importado, a IR e o assembly.
 */
import { INT, FLOAT, VOID, ptr, array } from './types.js';
import { cInt, cFloat, cBool, cNull } from './irgen.js';
import { t } from '../i18n/index.js';

const IBIN = new Set(['add', 'sub', 'mul', 'sdiv', 'srem', 'and', 'or', 'xor', 'shl', 'ashr']);
const FBIN = new Set(['fadd', 'fsub', 'fmul', 'fdiv']);
const ICMP = new Set(['eq', 'ne', 'slt', 'sle', 'sgt', 'sge', 'ult', 'ule', 'ugt', 'uge']);
const FCMP = new Set(['oeq', 'one', 'olt', 'ole', 'ogt', 'oge', 'ord', 'ueq', 'une', 'ult', 'ule', 'ugt', 'uge', 'uno', 'true', 'false']);
const FLAGS = new Set(['nsw', 'nuw', 'exact', 'disjoint', 'nnan', 'ninf', 'nsz', 'arcp', 'contract', 'afn', 'reassoc', 'fast', 'inbounds', 'nneg', 'volatile']);
/** Atributos de parâmetro e de retorno que podem aparecer entre o tipo e o valor. */
const ATTRS = new Set(['noundef', 'signext', 'zeroext', 'nonnull', 'nocapture', 'readonly', 'writeonly', 'noalias', 'returned', 'inreg', 'dso_local', 'dso_preemptable', 'local_unnamed_addr', 'unnamed_addr', 'internal', 'private', 'external', 'linkonce_odr', 'weak', 'common', 'hidden', 'protected', 'default', 'fastcc', 'ccc', 'immarg', 'nofree', 'tail', 'musttail', 'notail']);

/** Erro de importação com a linha do .ll; key é a chave do texto traduzido (ll.*). */
class LLError extends Error {
    constructor(line, key, args = {}) {
        super(key);
        this.line = line;
        this.key = key;
        this.args = args;
    }
}

const TOKEN = /\s*(?:([%@](?:[-a-zA-Z$._][-a-zA-Z$._0-9]*|\d+|"[^"]*"))|(0x[0-9a-fA-F]+|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([a-zA-Z_][a-zA-Z_0-9.]*)|(#\d+|![a-zA-Z0-9_.]+)|(\.\.\.|[,()[\]{}=:*<>]))/y;

/** Divide uma linha em símbolos (sem o comentário). */
function tokenize(text, line) {
    const out = [];
    let pos = 0;
    let s = text;
    // Comentário: ';' fora de aspas.
    let q = false;
    for (let k = 0; k < s.length; k++) {
        if (s[k] === '"') q = !q;
        else if (s[k] === ';' && !q) { s = s.slice(0, k); break; }
    }
    while (pos < s.length) {
        if (/^\s*$/.test(s.slice(pos))) break;
        TOKEN.lastIndex = pos;
        const m = TOKEN.exec(s);
        if (!m) throw new LLError(line, 'll.syntax', { text: s.slice(pos).trim().slice(0, 30) });
        pos = TOKEN.lastIndex;
        if (m[1]) out.push({ k: m[1][0] === '%' ? 'local' : 'global', v: m[1].slice(1).replace(/^"|"$/g, '') });
        else if (m[2]) out.push({ k: 'num', v: m[2] });
        else if (m[3]) out.push({ k: 'word', v: m[3] });
        else if (m[4]) out.push({ k: 'meta', v: m[4] });
        else out.push({ k: 'p', v: m[5] });
    }
    return out;
}

/** Leitor de símbolos de uma linha. */
class Cursor {
    constructor(toks, line) { this.t = toks; this.i = 0; this.line = line; }
    peek(o = 0) { return this.t[this.i + o]; }
    next() { return this.t[this.i++]; }
    done() { return this.i >= this.t.length; }
    is(v, o = 0) { const x = this.peek(o); return !!x && x.v === v && (x.k === 'p' || x.k === 'word'); }
    accept(v) { if (this.is(v)) { this.i++; return true; } return false; }
    expect(v) {
        if (!this.accept(v)) throw new LLError(this.line, 'll.expected', { what: v, got: this.peek()?.v ?? '' });
    }
    word() {
        const x = this.next();
        if (!x || x.k !== 'word') throw new LLError(this.line, 'll.expected', { what: '<word>', got: x?.v ?? '' });
        return x.v;
    }
    skipFlags() { while (this.peek()?.k === 'word' && FLAGS.has(this.peek().v)) this.i++; }
    skipAttrs() {
        for (;;) {
            const x = this.peek();
            if (x?.k === 'word' && ATTRS.has(x.v)) { this.i++; continue; }
            if (x?.k === 'word' && (x.v === 'align' || x.v === 'dereferenceable') && this.peek(1)?.k === 'num') { this.i += 2; continue; }
            if (x?.k === 'word' && x.v === 'dereferenceable' && this.is('(', 1)) { this.i += 2; while (!this.done() && !this.accept(')')) this.i++; continue; }
            if (x?.k === 'meta') { this.i++; continue; }
            break;
        }
    }
}

/** Tipo da IR (texto): i32, i1, float, ptr, void, [N x i32] ou [N x float]. */
function parseType(c) {
    const x = c.peek();
    if (!x) throw new LLError(c.line, 'll.expected', { what: '<type>', got: '' });
    if (c.accept('[')) {
        const n = c.next();
        if (n?.k !== 'num') throw new LLError(c.line, 'll.expected', { what: 'N', got: n?.v ?? '' });
        c.expect('x');
        const of = parseType(c);
        c.expect(']');
        if (of !== 'i32' && of !== 'float') throw new LLError(c.line, 'll.type', { ty: `[${n.v} x ${of}]` });
        return `[${Number(n.v)} x ${of}]`;
    }
    if (x.k === 'word' && ['i32', 'i1', 'float', 'ptr', 'void'].includes(x.v)) {
        c.next();
        if (x.v === 'ptr' && c.is('addrspace')) throw new LLError(c.line, 'll.type', { ty: 'ptr addrspace' });
        return x.v;
    }
    const name = x.v === '{' || x.v === '<' ? `${x.v}...` : x.v;
    throw new LLError(c.line, 'll.type', { ty: name });
}

const arrayOf = (ty) => {
    const m = /^\[(\d+) x (i32|float)\]$/.exec(ty);
    return m ? { len: Number(m[1]), elem: m[2] } : null;
};
const sizeOf = (ty) => { const a = arrayOf(ty); return a ? 4 * a.len : 4; };
/** Tipo do MiniC equivalente (para os quadros e a tabela de variáveis). */
function miniType(ty, pointee = null) {
    const a = arrayOf(ty);
    if (a) return array(a.elem === 'i32' ? 'int' : 'float', a.len);
    if (ty === 'float') return FLOAT;
    if (ty === 'ptr') return ptr(pointee ?? 'int');
    if (ty === 'void') return VOID;
    return INT;
}

/** Constante float do LLVM: decimal, ou hexadecimal com os 64 bits do double. */
function floatConst(text, line) {
    if (/^0x[0-9a-fA-F]{16}$/.test(text)) {
        const dv = new DataView(new ArrayBuffer(8));
        dv.setBigUint64(0, BigInt(text));
        return Math.fround(dv.getFloat64(0));
    }
    if (/^0x/i.test(text)) throw new LLError(line, 'll.const', { text });
    return Math.fround(Number(text));
}

/**
 * Lê um arquivo .ll e monta o módulo no formato interno do simulador.
 * @param {string} text conteúdo do .ll
 * @returns {{module?: object, errors: Array<{line: number, col: number, key: string, args: object}>}}
 */
export function parseLL(text) {
    try {
        return { module: parseModule(text), errors: [] };
    } catch (e) {
        if (e instanceof LLError) return { errors: [{ line: e.line, col: 1, key: e.key, args: e.args, message: t(`err.${e.key}`, e.args) }] };
        throw e;
    }
}

function parseModule(text) {
    const lines = text.split('\n');
    const module = { globals: [], functions: [], source: 'll' };
    let k = 0;
    while (k < lines.length) {
        const ln = k + 1;
        const raw = lines[k];
        const s = raw.replace(/;.*$/, '').trim();
        k++;
        if (!s) continue;
        if (/^(source_filename|target|attributes|!|module\s+asm|\$)/.test(s)) continue;
        if (s.startsWith('declare')) continue;
        if (s.startsWith('@')) { module.globals.push(parseGlobal(tokenize(raw, ln), ln)); continue; }
        if (s.startsWith('define')) {
            const start = k - 1;
            let end = start;
            while (end < lines.length && lines[end].replace(/;.*$/, '').trim() !== '}') end++;
            if (end >= lines.length) throw new LLError(ln, 'll.noEnd');
            module.functions.push(parseFunction(lines, start, end, module));
            k = end + 1;
            continue;
        }
        if (/^%[-a-zA-Z$._0-9]+\s*=\s*type\b/.test(s)) throw new LLError(ln, 'll.type', { ty: 'struct' });
        throw new LLError(ln, 'll.syntax', { text: s.slice(0, 30) });
    }
    // Chamadas a funções que não estão no arquivo.
    const defined = new Set(module.functions.map((F) => F.name));
    for (const F of module.functions)
        for (const b of F.blocks)
            for (const i of b.insts)
                if (i.op === 'call' && !defined.has(i.fn)) throw new LLError(i.line, 'll.undefFn', { name: i.fn });
    if (!defined.has('main')) throw new LLError(1, 'll.noMain');
    return module;
}

function parseGlobal(toks, line) {
    const c = new Cursor(toks, line);
    const name = c.next().v;
    c.expect('=');
    c.skipAttrs();
    const kind = c.word();
    if (kind !== 'global' && kind !== 'constant') throw new LLError(line, 'll.syntax', { text: kind });
    const ty = parseType(c);
    const a = arrayOf(ty);
    const elemTy = a ? a.elem : ty;
    if (!['i32', 'float', 'ptr'].includes(elemTy)) throw new LLError(line, 'll.type', { ty });
    let values = null;
    const scalar = () => {
        const x = c.next();
        if (x?.k === 'word' && x.v === 'null') return 0;
        if (x?.k === 'word' && (x.v === 'zeroinitializer' || x.v === 'undef' || x.v === 'poison')) return 0;
        if (x?.k !== 'num') throw new LLError(line, 'll.const', { text: x?.v ?? '' });
        return elemTy === 'float' ? floatConst(x.v, line) : Number(x.v) | 0;
    };
    if (c.accept('zeroinitializer')) values = null;
    else if (a) {
        c.expect('[');
        values = [];
        while (!c.accept(']')) {
            parseType(c);
            values.push(scalar());
            c.accept(',');
        }
    } else values = [scalar()];
    const type = a ? array(a.elem === 'i32' ? 'int' : 'float', a.len) : elemTy === 'ptr' ? ptr('int') : miniType(ty);
    return { name, type, irTy: ty, elem: elemTy === 'float' ? 'float' : 'int', values, line, sym: { name, node: { id: null } } };
}

/** Linhas [start, end] de uma função: cabeçalho define ... { até }. */
function parseFunction(lines, start, end, module) {
    const hl = start + 1;
    const head = tokenize(lines[start], hl);
    const c = new Cursor(head, hl);
    c.expect('define');
    c.skipAttrs();
    const retTy = parseType(c);
    if (retTy.startsWith('[') || retTy === 'i1') throw new LLError(hl, 'll.type', { ty: retTy });
    c.skipAttrs();
    const nameTok = c.next();
    if (nameTok?.k !== 'global') throw new LLError(hl, 'll.expected', { what: '@name', got: nameTok?.v ?? '' });
    const F = {
        name: nameTok.v, retTy, ret: miniType(retTy), params: [], blocks: [], allocas: [], line: hl, endLine: end + 1,
        sym: { name: nameTok.v, node: { id: null } },
    };
    const vals = new Map();      // nome -> valor (temporário ou argumento)
    const defined = new Set();
    const firstUse = new Map();
    let curLine = hl;
    const local = (name, ty) => {
        if (!firstUse.has(name)) firstUse.set(name, curLine);
        if (!vals.has(name)) vals.set(name, { vk: 'temp', ty, name });
        const v = vals.get(name);
        if (!v.ty && ty) v.ty = ty;
        return v;
    };
    c.expect('(');
    let unnamed = 0;
    while (!c.accept(')')) {
        if (c.accept('...')) throw new LLError(hl, 'll.type', { ty: '...' });
        const ty = parseType(c);
        if (ty === 'void' || ty === 'i1' || ty.startsWith('[')) throw new LLError(hl, 'll.type', { ty });
        c.skipAttrs();
        let name;
        if (c.peek()?.k === 'local') name = c.next().v;
        else name = String(unnamed);
        if (/^\d+$/.test(name)) unnamed++;
        const value = { vk: 'arg', ty, name };
        vals.set(name, value);
        defined.add(name);
        F.params.push({ name, ty, value, sym: null });
        c.accept(',');
    }
    if (F.params.filter((p) => p.ty === 'float').length > 8 || F.params.filter((p) => p.ty !== 'float').length > 8)
        throw new LLError(hl, 'll.manyArgs');

    let cur = null;
    const blocks = new Map();
    const newBlock = (label, line) => {
        if (blocks.has(label)) throw new LLError(line, 'll.labelTwice', { name: label });
        const b = { label, insts: [], preds: [] };
        blocks.set(label, b);
        F.blocks.push(b);
        return b;
    };
    const labelRefs = [];
    const labelOf = (tok, line) => {
        if (tok?.k !== 'local') throw new LLError(line, 'll.expected', { what: '%label', got: tok?.v ?? '' });
        const ref = { name: tok.v, line };
        labelRefs.push(ref);
        return ref;
    };

    for (let k = start + 1; k < end; k++) {
        const line = k + 1;
        curLine = line;
        const toks = tokenize(lines[k], line);
        if (!toks.length) continue;
        // Rótulo de bloco: nome: ou número:
        if (toks.length >= 2 && toks[1].v === ':' && (toks[0].k === 'word' || toks[0].k === 'num')) {
            if (cur && !isTerm(cur)) throw new LLError(line, 'll.noTerm', { name: cur.label });
            cur = newBlock(toks[0].v, line);
            continue;
        }
        if (!cur) cur = newBlock('entry', line);
        else if (isTerm(cur)) throw new LLError(line, 'll.afterTerm', { name: cur.label });
        const emit = (inst) => { inst.line = line; inst.node = null; cur.insts.push(inst); return inst; };
        parseInst(new Cursor(toks, line), { F, local, defined, emit, labelOf, module });
    }
    if (!F.blocks.length) throw new LLError(hl, 'll.empty');
    if (!isTerm(cur)) throw new LLError(end + 1, 'll.noTerm', { name: cur.label });

    // Referências a rótulos: o bloco de entrada sem nome tem o número implícito (logo depois dos parâmetros).
    const entry = F.blocks[0];
    for (const r of labelRefs) {
        if (blocks.has(r.name)) continue;
        if (entry.label === 'entry' && r.name === String(unnamed)) { r.name = 'entry'; continue; }
        throw new LLError(r.line, 'll.noLabel', { name: r.name });
    }
    for (const b of F.blocks) for (const i of b.insts) {
        if (i.op === 'br') i.target = i.target.name;
        if (i.op === 'condbr') { i.t = i.t.name; i.f = i.f.name; }
        if (i.op === 'phi') i.incoming = i.incoming.map(([v, l]) => [v, l.name]);
    }
    for (const b of F.blocks) for (const i of b.insts)
        if ((i.op === 'br' && i.target === entry.label) || (i.op === 'condbr' && (i.t === entry.label || i.f === entry.label)))
            throw new LLError(i.line, 'll.entryPred');

    // Valores usados e nunca definidos.
    for (const name of vals.keys()) if (!defined.has(name)) throw new LLError(firstUse.get(name) ?? hl, 'll.undefValue', { name });

    // Allocas: só no bloco de entrada (como no clang -O0); recebem um tipo do MiniC para os quadros.
    for (const b of F.blocks) for (const i of b.insts) if (i.op === 'alloca') {
        if (b !== entry) throw new LLError(i.line, 'll.allocaEntry');
        F.allocas.push(i);
    }
    annotateAllocas(F);
    cleanup(F);
    void module;
    return F;
}

const isTerm = (b) => ['br', 'condbr', 'ret'].includes(b.insts[b.insts.length - 1]?.op);

/** Símbolo de cada alloca: parâmetro (quando recebe um argumento) ou variável local, com o tipo apontado. */
function annotateAllocas(F) {
    const loadedFrom = new Map();
    const pointee = new Map();
    for (const b of F.blocks) for (const i of b.insts) {
        if (i.op === 'load' && i.ty === 'ptr') loadedFrom.set(i.dst, i.ptr);
    }
    for (const b of F.blocks) for (const i of b.insts) {
        if (i.op === 'gep' && loadedFrom.has(i.base)) pointee.set(loadedFrom.get(i.base), i.elem === 'float' ? 'float' : 'int');
        if (i.op === 'load' && i.ty !== 'ptr' && loadedFrom.has(i.ptr)) pointee.set(loadedFrom.get(i.ptr), i.ty === 'float' ? 'float' : 'int');
        if (i.op === 'store' && i.ty !== 'ptr' && loadedFrom.has(i.ptr)) pointee.set(loadedFrom.get(i.ptr), i.ty === 'float' ? 'float' : 'int');
    }
    const params = new Map();
    for (const i of F.blocks[0].insts) if (i.op === 'store' && i.val.vk === 'arg' && !params.has(i.ptr)) params.set(i.ptr, i.val);
    for (const a of F.allocas) {
        const arg = params.get(a.dst);
        a.sym = {
            name: arg ? `%${arg.name}` : `%${a.dst.name}`, kind: arg ? 'param' : 'local',
            type: miniType(a.allocTy, pointee.get(a.dst)), id: undefined, node: { id: null },
        };
    }
}

/** Remove blocos inalcançáveis e calcula os predecessores (como em irgen). */
function cleanup(F) {
    const byLabel = new Map(F.blocks.map((b) => [b.label, b]));
    const succ = (b) => {
        const t = b.insts[b.insts.length - 1];
        return t.op === 'br' ? [t.target] : t.op === 'condbr' ? [t.t, t.f] : [];
    };
    const reach = new Set([F.blocks[0].label]);
    const work = [F.blocks[0].label];
    while (work.length) for (const s of succ(byLabel.get(work.pop()))) if (!reach.has(s)) { reach.add(s); work.push(s); }
    F.blocks = F.blocks.filter((b) => reach.has(b.label));
    for (const b of F.blocks) b.preds = [];
    for (const b of F.blocks) for (const s of succ(b)) if (!byLabel.get(s).preds.includes(b.label)) byLabel.get(s).preds.push(b.label);
    for (const b of F.blocks) for (const i of b.insts) if (i.op === 'phi') {
        i.incoming = i.incoming.filter(([, l]) => reach.has(l));
        for (const p of b.preds) if (!i.incoming.some(([, l]) => l === p)) throw new LLError(i.line, 'll.phiPred', { name: p });
    }
}

/** Uma instrução. */
function parseInst(c, ctx) {
    const { F, local, defined, emit, labelOf } = ctx;
    const line = c.line;
    let dstName = null;
    if (c.peek()?.k === 'local' && c.is('=', 1)) {
        dstName = c.next().v;
        c.next();
        if (defined.has(dstName)) throw new LLError(line, 'll.defTwice', { name: dstName });
        defined.add(dstName);
    }
    const dst = (ty) => {
        if (dstName === null) throw new LLError(line, 'll.noDst');
        return local(dstName, ty);
    };
    c.accept('tail'); c.accept('musttail'); c.accept('notail');
    const op = c.word();

    /** Operando de tipo conhecido. */
    const value = (ty) => {
        const x = c.peek();
        if (!x) throw new LLError(line, 'll.expected', { what: '<value>', got: '' });
        if (x.k === 'local') { c.next(); return local(x.v, ty); }
        if (x.k === 'global') { c.next(); return { vk: 'global', ty: 'ptr', name: x.v }; }
        if (x.k === 'num') {
            c.next();
            if (ty === 'float') return cFloat(floatConst(x.v, line));
            if (ty === 'i1') return cBool(Number(x.v) !== 0);
            if (ty === 'ptr') throw new LLError(line, 'll.const', { text: x.v });
            if (x.v.startsWith('0x')) return cInt(Number(BigInt.asIntN(32, BigInt(x.v))));
            const n = Number(x.v);
            if (!Number.isInteger(n) || n > 0xffffffff || n < -0x80000000) throw new LLError(line, 'll.const', { text: x.v });
            return cInt(n);
        }
        if (x.k === 'word') {
            c.next();
            if (x.v === 'true' || x.v === 'false') return ty === 'i1' ? cBool(x.v === 'true') : cInt(x.v === 'true' ? 1 : 0);
            if (x.v === 'null') return cNull();
            if (x.v === 'undef' || x.v === 'poison') return { vk: 'undef', ty };
            if (x.v === 'getelementptr') return constGep();
            if (x.v === 'zeroinitializer') return ty === 'float' ? cFloat(0) : cInt(0);
        }
        throw new LLError(line, 'll.const', { text: x.v });
    };
    /** getelementptr constante (por exemplo, o endereço de C[8]): vira uma instrução antes desta. */
    const constGep = () => {
        c.skipFlags();
        c.expect('(');
        const g = gepTail(true);
        c.expect(')');
        const t = { vk: 'temp', ty: 'ptr', name: null };
        emit({ op: 'gep', dst: t, ...g });
        return t;
    };
    /** Resto de um getelementptr: tipo, ptr base, índices. */
    const gepTail = () => {
        c.skipFlags();
        const ety = parseType(c);
        c.expect(',');
        if (parseType(c) !== 'ptr') throw new LLError(line, 'll.type', { ty: 'gep' });
        const base = value('ptr');
        const idx = [];
        while (c.accept(',')) {
            c.skipFlags();
            if (c.peek()?.k === 'meta') { c.next(); continue; }
            const ity = parseType(c);
            if (ity !== 'i32') throw new LLError(line, 'll.type', { ty: ity });
            idx.push(value('i32'));
        }
        const a = arrayOf(ety);
        if (a) {
            if (idx.length === 1) {
                // Passo de um vetor inteiro: base + idx * (tamanho do vetor).
                if (idx[0].vk !== 'const') throw new LLError(line, 'll.gep');
                return { elem: a.elem, base, index: cInt(idx[0].v * a.len) };
            }
            if (idx.length !== 2 || idx[0].vk !== 'const' || idx[0].v !== 0) throw new LLError(line, 'll.gep');
            return { elem: a.elem, base, index: idx[1] };
        }
        if (idx.length !== 1 || !['i32', 'float', 'ptr'].includes(ety)) throw new LLError(line, 'll.gep');
        return { elem: ety === 'float' ? 'float' : ety === 'ptr' ? 'i32' : 'i32', base, index: idx[0] };
    };
    const typed = () => { const ty = parseType(c); c.skipAttrs(); return { ty, v: value(ty) }; };
    const tail = () => {
        // align, !metadata e o resto que não muda o significado.
        while (c.accept(',')) {
            if (c.accept('align')) { c.next(); continue; }
            if (c.peek()?.k === 'meta') { c.next(); c.next(); continue; }
            throw new LLError(line, 'll.syntax', { text: c.peek()?.v ?? '' });
        }
    };

    /**
     * llvm.memcpy e llvm.memset com tamanho constante (o clang usa para iniciar vetores locais) viram uma
     * sequência de load e store de palavras, com o tipo do elemento do vetor de destino.
     */
    const memIntrinsic = (fn) => {
        c.expect('(');
        const arg = (want) => {
            const ty = c.next()?.v;
            if (ty !== want) throw new LLError(line, 'll.intrinsic', { name: fn });
            c.skipAttrs();
            if (want === 'ptr') return value('ptr');
            const x = c.next();
            if (want === 'i1') return x.v;
            if (x?.k !== 'num') throw new LLError(line, 'll.intrinsic', { name: fn });
            return Number(x.v);
        };
        const dstP = arg('ptr'); c.expect(',');
        const isSet = fn.startsWith('llvm.memset');
        const src = isSet ? arg('i8') : arg('ptr'); c.expect(',');
        const len = arg('i32'); c.expect(',');
        const vol = arg('i1'); c.expect(')');
        if (vol !== 'false' || len % 4 !== 0 || len < 0) throw new LLError(line, 'll.intrinsic', { name: fn });
        const allocTy = F.blocks[0]?.insts.find((i) => i.op === 'alloca' && i.dst === dstP)?.allocTy;
        const g = !isSet && src.vk === 'global' ? ctx.module.globals.find((x) => x.name === src.name) : null;
        let elem = arrayOf(allocTy ?? '')?.elem ?? (allocTy === 'float' ? 'float' : g?.elem === 'float' ? 'float' : 'i32');
        if (isSet && (src & 0xff) !== 0) elem = 'i32';
        const tmp = (ty) => ({ vk: 'temp', ty, name: null });
        for (let k = 0; k < len / 4; k++) {
            let v;
            if (isSet) v = elem === 'float' ? cFloat(0) : cInt((src & 0xff) * 0x01010101);
            else {
                const sp = emit({ op: 'gep', dst: tmp('ptr'), elem, base: src, index: cInt(k) }).dst;
                v = emit({ op: 'load', dst: tmp(elem), ty: elem, ptr: sp }).dst;
            }
            const dp = emit({ op: 'gep', dst: tmp('ptr'), elem, base: dstP, index: cInt(k) }).dst;
            emit({ op: 'store', ty: elem, val: v, ptr: dp });
        }
    };

    if (IBIN.has(op)) {
        c.skipFlags();
        const ty = parseType(c);
        if (ty !== 'i32' && !(ty === 'i1' && ['and', 'or', 'xor'].includes(op))) throw new LLError(line, 'll.type', { ty });
        const a = value(ty); c.expect(','); const b = value(ty);
        emit({ op, dst: dst(ty), ty, a, b, ...(op === 'sdiv' && c.t.some((x) => x.v === 'exact') ? { exact: true } : {}) });
    } else if (FBIN.has(op)) {
        c.skipFlags();
        const ty = parseType(c);
        if (ty !== 'float') throw new LLError(line, 'll.type', { ty });
        const a = value(ty); c.expect(','); const b = value(ty);
        emit({ op, dst: dst('float'), ty: 'float', a, b });
    } else if (op === 'fneg') {
        c.skipFlags();
        if (parseType(c) !== 'float') throw new LLError(line, 'll.type', { ty: 'fneg' });
        emit({ op: 'fneg', dst: dst('float'), a: value('float') });
    } else if (op === 'icmp') {
        const cond = c.word();
        if (!ICMP.has(cond)) throw new LLError(line, 'll.syntax', { text: cond });
        const ty = parseType(c);
        if (ty !== 'i32' && ty !== 'ptr' && ty !== 'i1') throw new LLError(line, 'll.type', { ty });
        const a = value(ty); c.expect(','); const b = value(ty);
        if (ty === 'i1') {
            // icmp em i1 vira i32 com zext (o gerador de código trabalha com i32 e ptr).
            const za = a.vk === 'const' ? cInt(a.v) : emit({ op: 'zext', dst: { vk: 'temp', ty: 'i32', name: null }, a }).dst;
            const zb = b.vk === 'const' ? cInt(b.v) : emit({ op: 'zext', dst: { vk: 'temp', ty: 'i32', name: null }, a: b }).dst;
            emit({ op: 'icmp', cond, ty: 'i32', dst: dst('i1'), a: za, b: zb });
        } else emit({ op: 'icmp', cond, ty, dst: dst('i1'), a, b });
    } else if (op === 'fcmp') {
        c.skipFlags();
        const cond = c.word();
        if (!FCMP.has(cond) || ['ord', 'uno', 'true', 'false', 'one', 'ueq'].includes(cond)) throw new LLError(line, 'll.fcmp', { cond });
        if (parseType(c) !== 'float') throw new LLError(line, 'll.type', { ty: 'fcmp' });
        const a = value('float'); c.expect(','); const b = value('float');
        emit({ op: 'fcmp', cond, dst: dst('i1'), a, b });
    } else if (['zext', 'sitofp', 'fptosi', 'ptrtoint', 'bitcast', 'sext', 'trunc', 'uitofp', 'fptoui', 'inttoptr', 'fpext', 'fptrunc'].includes(op)) {
        c.skipFlags();
        const from = parseType(c);
        const a = value(from);
        c.expect('to');
        const to = parseType(c);
        const ok = (op === 'zext' && from === 'i1' && to === 'i32') || (op === 'sitofp' && from === 'i32' && to === 'float')
            || (op === 'fptosi' && from === 'float' && to === 'i32') || (op === 'ptrtoint' && from === 'ptr' && to === 'i32')
            || (op === 'bitcast' && ((from === 'i32' && to === 'float') || (from === 'float' && to === 'i32')));
        if (!ok) throw new LLError(line, 'll.cast', { op, from, to });
        if (op === 'bitcast') emit({ op, dst: dst(to), from, to, a });
        else emit({ op, dst: dst(to), a });
    } else if (op === 'alloca') {
        c.skipFlags();
        const ty = parseType(c);
        if (ty === 'void' || ty === 'i1') throw new LLError(line, 'll.type', { ty });
        if (c.accept(',') && !c.is('align')) throw new LLError(line, 'll.alloca');
        emit({ op: 'alloca', dst: dst('ptr'), allocTy: ty, bytes: sizeOf(ty) });
    } else if (op === 'load') {
        c.skipFlags();
        const ty = parseType(c);
        if (!['i32', 'float', 'ptr'].includes(ty)) throw new LLError(line, 'll.type', { ty });
        c.expect(',');
        if (parseType(c) !== 'ptr') throw new LLError(line, 'll.type', { ty: 'load' });
        const p = value('ptr');
        tail();
        emit({ op: 'load', dst: dst(ty), ty, ptr: p });
    } else if (op === 'store') {
        c.skipFlags();
        const ty = parseType(c);
        if (!['i32', 'float', 'ptr'].includes(ty)) throw new LLError(line, 'll.type', { ty });
        const v = value(ty);
        c.expect(',');
        if (parseType(c) !== 'ptr') throw new LLError(line, 'll.type', { ty: 'store' });
        const p = value('ptr');
        tail();
        emit({ op: 'store', ty, val: v, ptr: p });
    } else if (op === 'getelementptr') {
        const g = gepTail();
        emit({ op: 'gep', dst: dst('ptr'), ...g });
    } else if (op === 'br') {
        if (c.accept('label')) {
            emit({ op: 'br', target: labelOf(c.next(), line) });
        } else {
            if (parseType(c) !== 'i1') throw new LLError(line, 'll.type', { ty: 'br' });
            const cond = value('i1');
            c.expect(','); c.expect('label');
            const t = labelOf(c.next(), line);
            c.expect(','); c.expect('label');
            const f = labelOf(c.next(), line);
            emit({ op: 'condbr', cond, t, f });
        }
    } else if (op === 'ret') {
        const ty = parseType(c);
        if (ty !== F.retTy) throw new LLError(line, 'll.retType', { ty, want: F.retTy });
        emit({ op: 'ret', ty, val: ty === 'void' ? null : value(ty) });
    } else if (op === 'phi') {
        c.skipFlags();
        const ty = parseType(c);
        if (!['i32', 'float', 'ptr', 'i1'].includes(ty)) throw new LLError(line, 'll.type', { ty });
        const incoming = [];
        do {
            c.expect('[');
            const v = value(ty);
            c.expect(',');
            const l = labelOf(c.next(), line);
            c.expect(']');
            incoming.push([v, l]);
        } while (c.accept(','));
        emit({ op: 'phi', ty, dst: dst(ty), incoming });
    } else if (op === 'call') {
        c.skipFlags();
        c.skipAttrs();
        const retTy = parseType(c);
        c.skipAttrs();
        const fnTok = c.next();
        if (fnTok?.k !== 'global') throw new LLError(line, 'll.indirect');
        const fn = fnTok.v;
        if (/^llvm\.mem(cpy|set|move)\./.test(fn)) { memIntrinsic(fn); return; }
        c.expect('(');
        const args = [];
        while (!c.accept(')')) {
            args.push(typed());
            c.accept(',');
        }
        if (fn === 'llvm.fmuladd.f32' || fn === 'llvm.fma.f32') {
            if (args.length !== 3 || args.some((a) => a.ty !== 'float')) throw new LLError(line, 'll.type', { ty: fn });
            const m = emit({ op: 'fmul', dst: { vk: 'temp', ty: 'float', name: dstName === null ? null : `${dstName}.mul` }, ty: 'float', a: args[0].v, b: args[1].v }).dst;
            emit({ op: 'fadd', dst: dst('float'), ty: 'float', a: m, b: args[2].v });
            return;
        }
        if (fn.startsWith('llvm.')) throw new LLError(line, 'll.intrinsic', { name: fn });
        if (args.some((a) => a.ty === 'i1' || a.ty.startsWith('['))) throw new LLError(line, 'll.type', { ty: 'i1' });
        if (retTy === 'void' && dstName !== null) throw new LLError(line, 'll.type', { ty: 'void' });
        const d = retTy === 'void' ? null : dstName === null ? { vk: 'temp', ty: retTy, name: null } : dst(retTy);
        emit({ op: 'call', fn, retTy, args: args.map((a) => ({ ty: a.ty, val: a.v })), dst: d });
    } else {
        throw new LLError(line, 'll.op', { op });
    }
}

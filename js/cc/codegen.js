/**
 * Geração de código RISC-V (RV32IMF) a partir da IR, no estilo de um compilador sem otimização.
 *
 * Registro de ativação (quadro da pilha): o registrador s0 aponta para o topo do quadro (o valor de sp na
 * entrada da função). Abaixo dele ficam ra, o s0 anterior, as variáveis (cada alloca da IR vira uma posição
 * fixa, com deslocamento negativo em relação a s0) e as posições de valores temporários que precisam
 * sobreviver a um desvio ou a uma chamada. O tamanho do quadro é múltiplo de 16 bytes, como pede a ABI.
 *
 * Registradores: os valores temporários da IR usados dentro do mesmo bloco ficam nos registradores t0 a t5
 * (inteiros e endereços) e ft0 a ft7 (float), alocados na ordem e liberados no último uso; t6 é reservado para
 * endereços auxiliares. Os argumentos seguem a convenção de chamada do RISC-V: inteiros e ponteiros em a0 a a7,
 * floats em fa0 a fa7, e o resultado em a0 ou fa0. Todos os t e ft são salvos pelo chamador, então um valor
 * ainda vivo durante uma chamada é guardado no quadro antes do jal.
 *
 * A comparação seguida de desvio condicional vira um único desvio (blt, bge...), como no livro; a função phi
 * vira cópias para uma posição do quadro no fim de cada bloco predecessor.
 */
import { numberValues, valueText, instText } from './irgen.js';

const INT_POOL = ['t0', 't1', 't2', 't3', 't4', 't5'];
const FP_POOL = ['ft0', 'ft1', 'ft2', 'ft3', 'ft4', 'ft5', 'ft6', 'ft7'];
const SCRATCH = 't6';

const fits12 = (v) => v >= -2048 && v <= 2047;
const isFloatTy = (ty) => ty === 'float';

/** Representação decimal mais curta que reproduz o float de 32 bits. */
export function f32Text(v) {
    if (Object.is(v, -0)) return '-0.0';
    for (let p = 1; p <= 9; p++) {
        const s = Number(v.toPrecision(p));
        if (Math.fround(s) === v) {
            const txt = String(s);
            return /[.eE]/.test(txt) ? txt : `${txt}.0`;
        }
    }
    return String(v);
}

const BRANCH = { slt: 'blt', sle: 'ble', sgt: 'bgt', sge: 'bge', eq: 'beq', ne: 'bne', ult: 'bltu', ule: 'bleu', ugt: 'bgtu', uge: 'bgeu' };
const INVERT = { slt: 'sge', sge: 'slt', sle: 'sgt', sgt: 'sle', eq: 'ne', ne: 'eq', ult: 'uge', uge: 'ult', ule: 'ugt', ugt: 'ule' };
const IREG = { add: 'add', sub: 'sub', mul: 'mul', sdiv: 'div', srem: 'rem', and: 'and', or: 'or', xor: 'xor', shl: 'sll', ashr: 'sra' };
const IIMM = { add: 'addi', and: 'andi', or: 'ori', xor: 'xori', shl: 'slli', ashr: 'srai' };
const FOP = { fadd: 'fadd.s', fsub: 'fsub.s', fmul: 'fmul.s', fdiv: 'fdiv.s' };

/** Operandos (valores lidos) de uma instrução da IR, sem contar as phi. */
function operands(i) {
    switch (i.op) {
        case 'alloca': case 'br': case 'phi': return [];
        case 'load': return [i.ptr];
        case 'store': return [i.val, i.ptr];
        case 'gep': return [i.base, i.index];
        case 'condbr': return [i.cond];
        case 'ret': return i.val ? [i.val] : [];
        case 'call': return i.args.map((a) => a.val);
        case 'zext': case 'sitofp': case 'fptosi': case 'ptrtoint': case 'fneg': return [i.a];
        default: return [i.a, i.b];
    }
}

/**
 * @param {object} module saída de generateIR (de preferência já impressa por printModule, para o mapa de linhas)
 * @param {{source?: string, irComments?: boolean, srcComments?: boolean}} opts
 * @returns {{text: string, lines: Array<{src: number|null, node: number|null, ir: number|null, fn?: string}>,
 *            frames: Array, entryRet: string}}
 */
export function generateAsm(module, opts = {}) {
    const { irComments = true, srcComments = true } = opts;
    const srcLines = opts.source ? opts.source.split(/\r?\n/) : null;
    const out = [];
    const floatPool = new Map();
    const poolLabel = (v) => {
        const key = Object.is(v, -0) ? '-0' : String(v);
        if (!floatPool.has(key)) floatPool.set(key, { label: `.LC${floatPool.size}`, v });
        return floatPool.get(key).label;
    };
    const line = (text, meta = {}) => out.push({ text, src: null, node: null, ir: null, ...meta });

    const main = module.functions.find((f) => f.name === 'main');
    const mainFloat = main && main.retTy === 'float';
    line('    .text');
    line('    jal ra, main', { note: 'start' });
    line('    ecall', { note: mainFloat ? 'end.fa0' : 'end.a0' });

    const frames = [];
    for (const F of module.functions) frames.push(genFunction(F, line, poolLabel, { irComments, srcComments, srcLines }));

    if (module.globals.length || floatPool.size) {
        line('');
        line('    .data');
        for (const g of module.globals) {
            const meta = { src: g.line, node: g.sym.node.id, ir: g.irLine ?? null };
            const n = g.type.k === 'array' ? g.type.len : 1;
            const dir = g.elem === 'float' ? '.float' : '.word';
            if (!g.values || g.values.every((v) => v === 0)) line(`${g.name}:`, meta), line(`    .zero ${4 * n}`, meta);
            else {
                const all = Array.from({ length: n }, (_, k) => g.values[k] ?? 0);
                line(`${g.name}:`, meta);
                line(`    ${dir} ${all.map((v) => (g.elem === 'float' ? f32Text(v) : String(v))).join(', ')}`, meta);
            }
        }
        for (const { label, v } of floatPool.values()) {
            line(`${label}:`);
            line(`    .float ${f32Text(v)}`, { note: 'pool' });
        }
    }
    return { out, frames, mainFloat, render: (tr) => render(out, tr) };
}

/**
 * Texto final do assembly, com os comentários alinhados.
 * @param {Function} tr tradução das notas (chaves asm.note.*); sem ela, as notas são omitidas
 */
export function render(out, tr = null) {
    const lines = [], text = [];
    for (const l of out) {
        let s = l.text;
        const c = l.comment ?? (l.note && tr ? tr(`asm.note.${l.note}`) : null);
        if (c) s = `${s.padEnd(28)} # ${c}`;
        text.push(s);
        lines.push({ src: l.src ?? null, node: l.node ?? null, ir: l.ir ?? null, ir2: l.ir2 ?? null, fn: l.fn ?? null, isSrc: !!l.isSrc });
    }
    return { text: text.join('\n') + '\n', lines };
}

function genFunction(F, emitLine, poolLabel, opts) {
    numberValues(F);
    const body = [];
    const blockIndex = new Map(F.blocks.map((b, k) => [b.label, k]));
    const label = (l) => `${F.name}.${l}`;
    const exitLabel = `${F.name}.exit`;
    let usedExit = false;

    // Quadro: ra e s0 nas duas primeiras posições, depois as allocas, depois as posições de temporários.
    const slots = [
        { name: 'ra', off: -4, size: 4, kind: 'ra' },
        { name: 's0', off: -8, size: 4, kind: 'fp' },
    ];
    let bottom = -8;
    const allocaOff = new Map();
    for (const a of F.allocas) {
        bottom -= a.bytes;
        allocaOff.set(a.dst, bottom);
        const t = a.sym.type;
        slots.push({ name: a.sym.name, off: bottom, size: a.bytes, kind: a.sym.kind === 'param' ? 'param' : t.k === 'array' ? 'array' : 'local', ty: a.allocTy, ir: valueText(a.dst) });
    }
    const slotOff = new Map();
    const slotOf = (v) => {
        if (!slotOff.has(v)) {
            bottom -= 4;
            slotOff.set(v, bottom);
            slots.push({ name: valueText(v), off: bottom, size: 4, kind: 'temp', ty: v.ty });
        }
        return slotOff.get(v);
    };

    // Usos de cada valor e blocos onde são usados (as entradas de phi contam no bloco predecessor).
    const uses = new Map(), useBlocks = new Map(), defBlock = new Map(), phiDst = new Set();
    const isTemp = (v) => v && v.vk === 'temp' && !allocaOff.has(v);
    const addUse = (v, bl) => {
        if (!isTemp(v)) return;
        uses.set(v, (uses.get(v) ?? 0) + 1);
        if (!useBlocks.has(v)) useBlocks.set(v, new Set());
        useBlocks.get(v).add(bl);
    };
    for (const b of F.blocks) {
        for (const i of b.insts) {
            if (i.dst && i.op !== 'alloca') defBlock.set(i.dst, b.label);
            if (i.op === 'phi') { phiDst.add(i.dst); for (const [v, l] of i.incoming) addUse(v, l); }
            for (const v of operands(i)) addUse(v, b.label);
        }
    }
    const crossBlock = (v) => phiDst.has(v) || [...(useBlocks.get(v) ?? [])].some((l) => l !== defBlock.get(v));

    // Parâmetros: registradores de argumento.
    const argReg = new Map();
    let ni = 0, nf = 0;
    for (const p of F.params) argReg.set(p.value, isFloatTy(p.ty) ? `fa${nf++}` : `a${ni++}`);

    // Estado dos registradores.
    const regOf = new Map();       // valor -> registrador
    const owner = new Map();       // registrador -> valor (ou null para uso passageiro)
    let pinned = new Set();
    let transient = [];
    let meta = {};
    let comment = null;
    let lastSrc = null;

    const emit = (text) => {
        body.push({ text: `    ${text}`, ...meta, comment });
        comment = null;
    };
    const emitLabel = (text, m = {}) => body.push({ text, src: null, node: null, ir: null, ...m });

    const spill = (r) => {
        const v = owner.get(r);
        if (v) {
            mem(isFloatTy(v.ty) ? 'fsw' : 'sw', r, 's0', slotOf(v));
            regOf.delete(v);
        }
        owner.delete(r);
    };
    const alloc = (fp) => {
        const pool = fp ? FP_POOL : INT_POOL;
        let r = pool.find((x) => !owner.has(x) && !pinned.has(x));
        if (!r) {
            // Sem registrador livre: guarda no quadro o valor com mais usos pela frente.
            const cands = pool.filter((x) => !pinned.has(x) && owner.get(x));
            cands.sort((a, b) => (uses.get(owner.get(b)) ?? 0) - (uses.get(owner.get(a)) ?? 0));
            r = cands[0];
            spill(r);
        }
        owner.set(r, null);
        pinned.add(r);
        return r;
    };
    const freeReg = (r) => {
        if (!INT_POOL.includes(r) && !FP_POOL.includes(r)) return;
        const v = owner.get(r);
        if (v) regOf.delete(v);
        owner.delete(r);
    };

    /** Instrução de acesso à memória com deslocamento de qualquer tamanho. */
    function mem(op, reg, base, off) {
        if (fits12(off)) emit(`${op} ${reg}, ${off}(${base})`);
        else {
            emit(`li ${SCRATCH}, ${off}`);
            emit(`add ${SCRATCH}, ${base}, ${SCRATCH}`);
            emit(`${op} ${reg}, 0(${SCRATCH})`);
        }
    }

    /** Coloca o valor em um registrador específico. */
    function materializeInto(v, r) {
        const fp = r.startsWith('f');
        switch (v.vk) {
            case 'const':
                if (fp) {
                    if (v.v === 0 && !Object.is(v.v, -0)) emit(`fmv.w.x ${r}, zero`);
                    else { emit(`la ${SCRATCH}, ${poolLabel(v.v)}`); emit(`flw ${r}, 0(${SCRATCH})`); }
                } else emit(`li ${r}, ${v.v}`);
                return;
            case 'global': emit(`la ${r}, ${v.name}`); return;
            case 'arg': emit(`${fp ? 'fmv.s' : 'mv'} ${r}, ${argReg.get(v)}`); return;
            default:
                if (allocaOff.has(v)) {
                    const off = allocaOff.get(v);
                    if (fits12(off)) emit(`addi ${r}, s0, ${off}`);
                    else { emit(`li ${r}, ${off}`); emit(`add ${r}, s0, ${r}`); }
                } else if (regOf.has(v)) {
                    if (regOf.get(v) !== r) emit(`${fp ? 'fmv.s' : 'mv'} ${r}, ${regOf.get(v)}`);
                } else mem(fp ? 'flw' : 'lw', r, 's0', slotOf(v));
        }
    }

    /** Registrador com o valor, para leitura (carrega se preciso). */
    function getReg(v) {
        if (v.vk === 'const' && v.ty !== 'float' && v.v === 0) return 'zero';
        if (v.vk === 'arg') return argReg.get(v);
        if (isTemp(v) && regOf.has(v)) { pinned.add(regOf.get(v)); return regOf.get(v); }
        const r = alloc(isFloatTy(v.ty));
        materializeInto(v, r);
        transient.push(r);
        return r;
    }

    /** Endereço de um acesso à memória: base e deslocamento. */
    function addrOf(p) {
        if (allocaOff.has(p)) return { base: 's0', off: allocaOff.get(p) };
        return { base: getReg(p), off: 0 };
    }

    /** Fim da leitura dos operandos: libera registradores de valores no último uso e os passageiros. */
    function release(vals) {
        for (const v of vals) {
            if (!isTemp(v)) continue;
            const n = (uses.get(v) ?? 1) - 1;
            uses.set(v, n);
            if (n <= 0 && regOf.has(v)) freeReg(regOf.get(v));
        }
        for (const r of transient) freeReg(r);
        transient = [];
        pinned = new Set();
    }

    /** Resultado de uma instrução no registrador r. */
    function define(v, r) {
        pinned.delete(r);
        if ((uses.get(v) ?? 0) === 0) { owner.delete(r); return; }
        if (crossBlock(v)) {
            mem(isFloatTy(v.ty) ? 'fsw' : 'sw', r, 's0', slotOf(v));
            owner.delete(r);
            return;
        }
        owner.set(r, v);
        regOf.set(v, r);
    }

    /** Reaproveita como destino um registrador de operando que acabou de ser liberado (sem instrução). */
    function reuseOrMove(src, fp) {
        if ((INT_POOL.includes(src) || FP_POOL.includes(src)) && !owner.has(src)) {
            owner.set(src, null);
            return src;
        }
        const r = alloc(fp);
        emit(`${fp ? 'fmv.s' : 'mv'} ${r}, ${src}`);
        return r;
    }

    function phiCopies(from, toLabel) {
        const to = F.blocks[blockIndex.get(toLabel)];
        for (const i of to.insts) {
            if (i.op !== 'phi') continue;
            const inc = i.incoming.find(([, l]) => l === from.label);
            if (!inc) continue;
            setMeta(i);
            const fp = isFloatTy(i.ty);
            const r = getReg(inc[0]);
            mem(fp ? 'fsw' : 'sw', r, 's0', slotOf(i.dst));
            release([inc[0]]);
        }
    }

    function setMeta(i) {
        meta = { src: i.line ?? null, node: i.node ?? null, ir: i.irLine ?? null, fn: F.name };
        if (opts.irComments) comment = instText(i);
        if (opts.srcComments && opts.srcLines && i.line && i.line !== lastSrc && i.op !== 'alloca') {
            lastSrc = i.line;
            const s = opts.srcLines[i.line - 1]?.trim();
            if (s) body.push({ text: `    # ${i.line}: ${s}`, src: i.line, node: null, ir: null, fn: F.name, isSrc: true });
        }
    }

    const jumpTo = (bi, target) => {
        if (blockIndex.get(target) !== bi + 1) emit(`j ${label(target)}`);
    };

    F.blocks.forEach((b, bi) => {
        if (bi > 0) emitLabel(`${label(b.label)}:`, { fn: F.name, block: b.label });
        lastSrc = bi === 0 ? null : lastSrc;
        const term = b.insts[b.insts.length - 1];
        // Comparação inteira usada só pelo desvio que vem logo depois: vira um desvio condicional único.
        const prev = b.insts[b.insts.length - 2];
        const fuse = term.op === 'condbr' && prev && prev.op === 'icmp' && term.cond === prev.dst && uses.get(prev.dst) === 1;

        for (const i of b.insts) {
            if (i === term) break;
            if (fuse && i === prev) break;
            if (i.op === 'alloca' || i.op === 'phi') continue;
            setMeta(i);
            genInst(i);
        }

        // Cópias das phi dos sucessores, antes do desvio.
        if (term.op === 'br') phiCopies(b, term.target);
        if (term.op === 'condbr') { phiCopies(b, term.t); phiCopies(b, term.f); }

        setMeta(term);
        if (fuse) {
            meta.ir2 = prev.irLine ?? null;
            if (opts.irComments) comment = `${instText(prev)}; ${instText(term)}`;
        }
        switch (term.op) {
            case 'br': jumpTo(bi, term.target); break;
            case 'condbr': {
                if (fuse) {
                    const a = getReg(prev.a), c = getReg(prev.b);
                    release([prev.a, prev.b]);
                    uses.set(prev.dst, 0);
                    if (blockIndex.get(term.f) === bi + 1) emit(`${BRANCH[prev.cond]} ${a}, ${c}, ${label(term.t)}`);
                    else {
                        emit(`${BRANCH[INVERT[prev.cond]]} ${a}, ${c}, ${label(term.f)}`);
                        if (blockIndex.get(term.t) !== bi + 1) emit(`j ${label(term.t)}`);
                    }
                    break;
                }
                const c = getReg(term.cond);
                release([term.cond]);
                if (blockIndex.get(term.f) === bi + 1) emit(`bnez ${c}, ${label(term.t)}`);
                else {
                    emit(`beqz ${c}, ${label(term.f)}`);
                    if (blockIndex.get(term.t) !== bi + 1) emit(`j ${label(term.t)}`);
                }
                break;
            }
            case 'ret': {
                if (term.val) {
                    const r = isFloatTy(term.ty) ? 'fa0' : 'a0';
                    materializeInto(term.val, r);
                    release([term.val]);
                }
                if (bi !== F.blocks.length - 1) { emit(`j ${exitLabel}`); usedExit = true; }
                break;
            }
            default: break;
        }
    });

    function genInst(i) {
        const d = i.dst;
        switch (i.op) {
            case 'load': {
                const a = addrOf(i.ptr);
                release([i.ptr]);
                const r = alloc(isFloatTy(i.ty));
                mem(isFloatTy(i.ty) ? 'flw' : 'lw', r, a.base, a.off);
                define(d, r);
                return;
            }
            case 'store': {
                const v = getReg(i.val);
                const a = addrOf(i.ptr);
                mem(isFloatTy(i.ty) ? 'fsw' : 'sw', v, a.base, a.off);
                release([i.val, i.ptr]);
                return;
            }
            case 'add': case 'sub': case 'mul': case 'sdiv': case 'srem': case 'and': case 'or': case 'xor': case 'shl': case 'ashr': {
                const a = getReg(i.a);
                if (i.exact && i.op === 'sdiv' && i.b.vk === 'const' && i.b.v === 4) {
                    release([i.a]);
                    const r = alloc(false);
                    emit(`srai ${r}, ${a}, 2`);
                    define(d, r);
                    return;
                }
                const k = i.b.vk === 'const' ? i.b.v : null;
                let imm = null;
                if (k !== null) {
                    if (i.op === 'sub' && fits12(-k)) imm = ['addi', -k];
                    else if ((i.op === 'shl' || i.op === 'ashr') && k >= 0 && k < 32) imm = [IIMM[i.op], k];
                    else if (IIMM[i.op] && i.op !== 'shl' && i.op !== 'ashr' && fits12(k)) imm = [IIMM[i.op], k];
                }
                if (imm) {
                    release([i.a, i.b]);
                    const r = alloc(false);
                    emit(`${imm[0]} ${r}, ${a}, ${imm[1]}`);
                    define(d, r);
                    return;
                }
                const b = getReg(i.b);
                release([i.a, i.b]);
                const r = alloc(false);
                emit(i.op === 'sub' && a === 'zero' ? `neg ${r}, ${b}` : `${IREG[i.op]} ${r}, ${a}, ${b}`);
                define(d, r);
                return;
            }
            case 'fadd': case 'fsub': case 'fmul': case 'fdiv': {
                const a = getReg(i.a), b = getReg(i.b);
                release([i.a, i.b]);
                const r = alloc(true);
                emit(`${FOP[i.op]} ${r}, ${a}, ${b}`);
                define(d, r);
                return;
            }
            case 'fneg': {
                const a = getReg(i.a);
                release([i.a]);
                const r = alloc(true);
                emit(`fneg.s ${r}, ${a}`);
                define(d, r);
                return;
            }
            case 'icmp': {
                const a = getReg(i.a);
                const k = i.b.vk === 'const' ? i.b.v : null;
                const sl = i.ty === 'ptr' ? 'sltu' : 'slt';
                if (k !== null && (i.cond === 'slt' || i.cond === 'ult') && fits12(k)) {
                    release([i.a, i.b]);
                    const r = alloc(false);
                    emit(`${sl}i ${r}, ${a}, ${k}`);
                    define(d, r);
                    return;
                }
                if (k === 0 && (i.cond === 'eq' || i.cond === 'ne')) {
                    release([i.a, i.b]);
                    const r = alloc(false);
                    emit(`${i.cond === 'eq' ? 'seqz' : 'snez'} ${r}, ${a}`);
                    define(d, r);
                    return;
                }
                const b = getReg(i.b);
                release([i.a, i.b]);
                const r = alloc(false);
                switch (i.cond) {
                    case 'eq': emit(`xor ${r}, ${a}, ${b}`); emit(`seqz ${r}, ${r}`); break;
                    case 'ne': emit(`xor ${r}, ${a}, ${b}`); emit(`snez ${r}, ${r}`); break;
                    case 'slt': case 'ult': emit(`${sl} ${r}, ${a}, ${b}`); break;
                    case 'sgt': case 'ugt': emit(`${sl} ${r}, ${b}, ${a}`); break;
                    case 'sle': case 'ule': emit(`${sl} ${r}, ${b}, ${a}`); emit(`xori ${r}, ${r}, 1`); break;
                    case 'sge': case 'uge': emit(`${sl} ${r}, ${a}, ${b}`); emit(`xori ${r}, ${r}, 1`); break;
                    default: break;
                }
                define(d, r);
                return;
            }
            case 'fcmp': {
                const a = getReg(i.a), b = getReg(i.b);
                release([i.a, i.b]);
                const r = alloc(false);
                switch (i.cond) {
                    case 'oeq': emit(`feq.s ${r}, ${a}, ${b}`); break;
                    case 'une': emit(`feq.s ${r}, ${a}, ${b}`); emit(`xori ${r}, ${r}, 1`); break;
                    case 'olt': emit(`flt.s ${r}, ${a}, ${b}`); break;
                    case 'ole': emit(`fle.s ${r}, ${a}, ${b}`); break;
                    case 'ogt': emit(`flt.s ${r}, ${b}, ${a}`); break;
                    case 'oge': emit(`fle.s ${r}, ${b}, ${a}`); break;
                    default: break;
                }
                define(d, r);
                return;
            }
            case 'zext': case 'ptrtoint': {
                const a = getReg(i.a);
                release([i.a]);
                define(d, reuseOrMove(a, false));
                return;
            }
            case 'sitofp': {
                const a = getReg(i.a);
                release([i.a]);
                const r = alloc(true);
                emit(`fcvt.s.w ${r}, ${a}`);
                define(d, r);
                return;
            }
            case 'fptosi': {
                const a = getReg(i.a);
                release([i.a]);
                const r = alloc(false);
                emit(`fcvt.w.s ${r}, ${a}, rtz`);
                define(d, r);
                return;
            }
            case 'gep': {
                const base = getReg(i.base);
                if (i.index.vk === 'const') {
                    const off = 4 * i.index.v;
                    release([i.base, i.index]);
                    if (off === 0) { define(d, reuseOrMove(base, false)); return; }
                    const r = alloc(false);
                    if (fits12(off)) emit(`addi ${r}, ${base}, ${off}`);
                    else { emit(`li ${r}, ${off}`); emit(`add ${r}, ${base}, ${r}`); }
                    define(d, r);
                    return;
                }
                const idx = getReg(i.index);
                // O destino é escolhido antes de liberar a base, porque a base ainda é lida depois do slli.
                const r = alloc(false);
                emit(`slli ${r}, ${idx}, 2`);
                emit(`add ${r}, ${base}, ${r}`);
                release([i.base, i.index]);
                define(d, r);
                return;
            }
            case 'call': {
                let ai = 0, af = 0;
                const vals = i.args.map((a) => a.val);
                i.args.forEach((a) => materializeInto(a.val, isFloatTy(a.ty) ? `fa${af++}` : `a${ai++}`));
                release(vals);
                // Os registradores t e ft são salvos pelo chamador: valores ainda vivos vão para o quadro.
                for (const r of [...INT_POOL, ...FP_POOL]) if (owner.get(r)) spill(r);
                emit(`jal ra, ${i.fn}`);
                if (d && (uses.get(d) ?? 0) > 0) {
                    const fp = isFloatTy(d.ty);
                    const r = alloc(fp);
                    emit(`${fp ? 'fmv.s' : 'mv'} ${r}, ${fp ? 'fa0' : 'a0'}`);
                    define(d, r);
                }
                pinned = new Set();
                return;
            }
            default: throw new Error(`codegen: ${i.op}`);
        }
    }

    // Prólogo e epílogo, agora que o tamanho do quadro é conhecido.
    const size = Math.ceil(-bottom / 16) * 16;
    const fm = { src: F.line, node: F.sym.node.id, ir: null, fn: F.name };
    const em = { src: F.endLine, node: F.sym.node.id, ir: null, fn: F.name };
    emitLine('');
    emitLine(`${F.name}:`, { ...fm, fnLabel: F.name });
    const pro = (text, c) => emitLine(`    ${text}`, { ...fm, note: c, prologue: true });
    if (fits12(size)) {
        pro(`addi sp, sp, -${size}`, 'pro.alloc');
        pro(`sw ra, ${size - 4}(sp)`, 'pro.ra');
        pro(`sw s0, ${size - 8}(sp)`, 'pro.s0');
        pro(`addi s0, sp, ${size}`, 'pro.fp');
    } else {
        pro(`mv ${SCRATCH}, sp`, 'pro.big');
        pro(`li t0, ${size}`, null);
        pro(`sub sp, sp, t0`, 'pro.alloc');
        pro(`sw ra, -4(${SCRATCH})`, 'pro.ra');
        pro(`sw s0, -8(${SCRATCH})`, 'pro.s0');
        pro(`mv s0, ${SCRATCH}`, 'pro.fp');
    }
    for (const l of body) emitLine(l.text, l);
    if (usedExit) emitLine(`${exitLabel}:`, { ...em, block: 'exit' });
    const epi = (text, c) => emitLine(`    ${text}`, { ...em, note: c, epilogue: true });
    if (fits12(size)) {
        epi(`lw ra, ${size - 4}(sp)`, 'epi.ra');
        epi(`lw s0, ${size - 8}(sp)`, 'epi.s0');
        epi(`addi sp, sp, ${size}`, 'epi.free');
    } else {
        epi('mv sp, s0', 'epi.free');
        epi('lw ra, -4(sp)', 'epi.ra');
        epi('lw s0, -8(sp)', 'epi.s0');
    }
    epi('ret', 'epi.ret');
    return { fn: F.name, size, slots: slots.map((s) => ({ ...s, spOff: s.off + size })) };
}

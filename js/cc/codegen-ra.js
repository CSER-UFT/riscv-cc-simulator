/**
 * Geração de código com alocação de registradores para a função inteira (linear scan, Poletto e Sarkar, 1999).
 *
 * 1. Vivacidade: para cada bloco, os valores vivos na entrada e na saída (as entradas de uma phi contam como
 *    usadas no fim do bloco predecessor, e a phi é definida no início do seu bloco).
 * 2. Intervalos: as instruções são numeradas na ordem do texto e cada valor ganha o intervalo do primeiro ao
 *    último ponto em que está vivo.
 * 3. Varredura: os intervalos são percorridos em ordem de início; cada um recebe um registrador livre. Um valor
 *    vivo durante uma chamada só pode ficar num registrador salvo pela função chamada (s1 a s11, fs0 a fs11),
 *    que o prólogo guarda e o epílogo restaura; os demais preferem os temporários (t0 a t3, ft0 a ft9), que não
 *    precisam ser guardados. Sem registrador livre, o intervalo que termina mais tarde vai para o quadro
 *    (derramamento, spill) e é lido e escrito com os registradores auxiliares t4 a t6 e ft10, ft11.
 * 4. As phi viram cópias paralelas no fim de cada predecessor, ordenadas para que nenhum valor seja escrito antes
 *    de ser lido; um ciclo (como numa troca de variáveis) é quebrado com um registrador auxiliar.
 */
import { numberValues, valueText, instText } from './irgen.js';
import { str } from './types.js';
import { fits12, isFloatTy, BRANCH, INVERT, IREG, IIMM, FOP, operands, argName } from './codegen.js';

const INT_CALLER = ['t0', 't1', 't2', 't3'];
const INT_CALLEE = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11'];
const FP_CALLER = ['ft0', 'ft1', 'ft2', 'ft3', 'ft4', 'ft5', 'ft6', 'ft7', 'ft8', 'ft9'];
const FP_CALLEE = ['fs0', 'fs1', 'fs2', 'fs3', 'fs4', 'fs5', 'fs6', 'fs7', 'fs8', 'fs9', 'fs10', 'fs11'];
const TMP = 't4';                       // temporário dos ciclos de cópias
const SA = 't5', SB = 't6';             // auxiliares de operandos
const FSA = 'ft10', FTMP = 'ft11';

export function genFunctionRA(F, emitLine, poolLabel, opts) {
    numberValues(F);
    const body = [];
    const blockIndex = new Map(F.blocks.map((b, k) => [b.label, k]));
    const label = (l) => `${F.name}.${l}`;
    const exitLabel = `${F.name}.exit`;
    let usedExit = false;

    // Quadro: ra, s0, registradores salvos pela função chamada (preenchidos depois), allocas, derramamentos.
    const allocaOff = new Map();
    const allocaSlots = [];
    let allocBytes = 0;
    for (const a of F.allocas) {
        allocBytes += a.bytes;
        allocaSlots.push({ a, rel: allocBytes });
    }
    const isVal = (v) => v && ((v.vk === 'temp' && !F.allocas.some((a) => a.dst === v)) || v.vk === 'arg');
    const allocaSet = new Set(F.allocas.map((a) => a.dst));

    // Comparação usada só pelo desvio seguinte: vira um desvio condicional único (não ocupa registrador).
    const useCount = new Map();
    for (const b of F.blocks) for (const i of b.insts) {
        for (const v of operands(i)) useCount.set(v, (useCount.get(v) ?? 0) + 1);
        if (i.incoming) for (const [v] of i.incoming) useCount.set(v, (useCount.get(v) ?? 0) + 1);
    }
    const fused = new Set();
    for (const b of F.blocks) {
        const term = b.insts[b.insts.length - 1], prev = b.insts[b.insts.length - 2];
        if (term?.op === 'condbr' && prev?.op === 'icmp' && term.cond === prev.dst && useCount.get(prev.dst) === 1) fused.add(prev);
    }
    const defOf = new Map();
    for (const b of F.blocks) for (const i of b.insts) if (i.dst) defOf.set(i.dst, i);
    const realOps = (i) => {
        if (i.op === 'condbr' && fused.has(defOf.get(i.cond))) { const c = defOf.get(i.cond); return [c.a, c.b]; }
        return operands(i);
    };

    // Posições: duas por instrução; as cópias das phi ficam logo antes do terminador.
    const pos = new Map();
    const blockRange = new Map();
    let p = 2;
    for (const b of F.blocks) {
        const start = p;
        for (const i of b.insts) { pos.set(i, p); p += 2; }
        blockRange.set(b.label, { start, end: p - 2 });
    }
    const succs = (b) => {
        const t = b.insts[b.insts.length - 1];
        return t.op === 'br' ? [t.target] : t.op === 'condbr' ? [...new Set([t.t, t.f])] : [];
    };
    const byLabel = new Map(F.blocks.map((b) => [b.label, b]));

    // Vivacidade por blocos.
    const useB = new Map(), defB = new Map(), phiDefs = new Map(), phiUsesFrom = new Map();
    for (const b of F.blocks) {
        const u = new Set(), d = new Set(), pd = new Set();
        for (const i of b.insts) {
            if (i.op === 'phi') { pd.add(i.dst); d.add(i.dst); continue; }
            if (fused.has(i)) continue;
            for (const v of realOps(i)) if (isVal(v) && !d.has(v)) u.add(v);
            if (i.dst && isVal(i.dst)) d.add(i.dst);
        }
        useB.set(b.label, u); defB.set(b.label, d); phiDefs.set(b.label, pd);
    }
    for (const b of F.blocks) {
        for (const i of b.insts) if (i.op === 'phi') for (const [v, l] of i.incoming) {
            if (!phiUsesFrom.has(l)) phiUsesFrom.set(l, new Set());
            if (isVal(v)) phiUsesFrom.get(l).add(v);
        }
    }
    const liveIn = new Map(F.blocks.map((b) => [b.label, new Set()])), liveOut = new Map(F.blocks.map((b) => [b.label, new Set()]));
    for (let changed = true; changed;) {
        changed = false;
        for (const b of [...F.blocks].reverse()) {
            const out = new Set(phiUsesFrom.get(b.label) ?? []);
            for (const s of succs(b)) for (const v of liveIn.get(s)) if (!phiDefs.get(s).has(v)) out.add(v);
            const inn = new Set(useB.get(b.label));
            for (const v of out) if (!defB.get(b.label).has(v)) inn.add(v);
            if (out.size !== liveOut.get(b.label).size || inn.size !== liveIn.get(b.label).size) changed = true;
            liveOut.set(b.label, out); liveIn.set(b.label, inn);
        }
    }

    // Intervalos (do primeiro ao último ponto em que o valor está vivo).
    const iv = new Map();
    const touch = (v, at) => {
        if (!isVal(v)) return;
        const x = iv.get(v);
        if (!x) iv.set(v, { v, start: at, end: at });
        else { x.start = Math.min(x.start, at); x.end = Math.max(x.end, at); }
    };
    for (const prm of F.params) touch(prm.value, 0);
    const calls = [];
    for (const b of F.blocks) {
        const { start, end } = blockRange.get(b.label);
        for (const v of liveIn.get(b.label)) touch(v, start);
        for (const v of liveOut.get(b.label)) touch(v, end + 1);
        for (const i of b.insts) {
            const at = pos.get(i);
            if (i.op === 'phi') { touch(i.dst, start); continue; }
            if (fused.has(i)) continue;
            for (const v of realOps(i)) touch(v, at);
            if (i.dst && isVal(i.dst)) touch(i.dst, at);
            if (i.op === 'call') calls.push(at);
        }
        // Cópias das phi dos sucessores: as entradas são lidas e as phi escritas logo antes do terminador.
        for (const s of succs(b)) for (const i of byLabel.get(s).insts) if (i.op === 'phi') {
            touch(i.dst, end - 1);
            const inc = i.incoming.find(([, l]) => l === b.label);
            if (inc) touch(inc[0], end - 1);
        }
    }

    // Varredura linear.
    const reg = new Map(), spilled = new Set(), usedCallee = new Set();
    const intervals = [...iv.values()].sort((a, b) => a.start - b.start || a.end - b.end);
    let active = [];
    for (const it of intervals) {
        active = active.filter((a) => a.end >= it.start);
        const fp = isFloatTy(it.v.ty);
        it.cross = calls.some((c) => it.start < c && c < it.end);
        const busy = new Set(active.filter((a) => reg.has(a.v)).map((a) => reg.get(a.v)));
        const pool = it.cross ? (fp ? FP_CALLEE : INT_CALLEE) : [...(fp ? FP_CALLER : INT_CALLER), ...(fp ? FP_CALLEE : INT_CALLEE)];
        const r = pool.find((x) => !busy.has(x));
        if (r) { reg.set(it.v, r); active.push(it); continue; }
        // Sem registrador: derrama quem termina mais tarde entre os que poderiam ceder o seu.
        const cands = active.filter((a) => reg.has(a.v) && isFloatTy(a.v.ty) === fp && pool.includes(reg.get(a.v))).sort((a, b) => b.end - a.end);
        if (cands.length && cands[0].end > it.end) {
            const victim = cands[0];
            reg.set(it.v, reg.get(victim.v));
            reg.delete(victim.v);
            spilled.add(victim.v);
            active = active.filter((a) => a !== victim);
            active.push(it);
        } else spilled.add(it.v);
    }
    for (const r of reg.values()) if (INT_CALLEE.includes(r) || FP_CALLEE.includes(r)) usedCallee.add(r);

    // Posições do quadro.
    const slots = [{ name: 'ra', off: -4, size: 4, kind: 'ra' }, { name: 's0', off: -8, size: 4, kind: 'fp' }];
    let bottom = -8;
    const calleeOff = new Map();
    for (const r of [...INT_CALLEE, ...FP_CALLEE].filter((x) => usedCallee.has(x))) {
        bottom -= 4;
        calleeOff.set(r, bottom);
        slots.push({ name: r, off: bottom, size: 4, kind: 'saved' });
    }
    for (const { a } of allocaSlots) {
        bottom -= a.bytes;
        allocaOff.set(a.dst, bottom);
        const t = a.sym?.type;
        slots.push({ name: a.sym?.name ?? valueText(a.dst), off: bottom, size: a.bytes, kind: a.sym?.kind === 'param' ? 'param' : t?.k === 'array' ? 'array' : 'local', ty: t ? str(t) : a.allocTy, ir: valueText(a.dst), sym: a.sym?.id });
    }
    const slotOff = new Map();
    const slotOf = (v) => {
        if (!slotOff.has(v)) {
            bottom -= 4;
            slotOff.set(v, bottom);
            slots.push({ name: valueText(v), off: bottom, size: 4, kind: 'spill', ty: v.ty });
        }
        return slotOff.get(v);
    };
    for (const v of spilled) slotOf(v);

    // Emissão ---------------------------------------------------------------------------------------------------
    let meta = {}, comment = null, lastSrc = null;
    const emit = (text) => { body.push({ text: `    ${text}`, ...meta, comment }); comment = null; };
    const emitLabel = (text, m = {}) => body.push({ text, src: null, node: null, ir: null, ...m });
    function mem(op, r, base, off) {
        if (fits12(off)) { emit(`${op} ${r}, ${off}(${base})`); return; }
        const sc = [TMP, SA, SB].find((x) => x !== r && x !== base);
        emit(`li ${sc}, ${off}`);
        emit(`add ${sc}, ${base}, ${sc}`);
        emit(`${op} ${r}, 0(${sc})`);
    }
    const argReg = new Map();
    let ni = 0, nf = 0;
    for (const prm of F.params) argReg.set(prm.value, isFloatTy(prm.ty) ? `fa${nf++}` : `a${ni++}`);

    /** Coloca o valor no registrador r. */
    function put(v, r) {
        const fp = r.startsWith('f');
        if (v.vk === 'const' || v.vk === 'undef') {
            const x = v.vk === 'undef' ? 0 : v.v;
            if (fp) {
                if (x === 0 && !Object.is(x, -0)) emit(`fmv.w.x ${r}, zero`);
                else { emit(`la ${SB}, ${poolLabel(x)}`); emit(`flw ${r}, 0(${SB})`); }
            } else emit(`li ${r}, ${x}`);
            return;
        }
        if (v.vk === 'global') { emit(`la ${r}, ${v.name}`); return; }
        if (allocaSet.has(v)) {
            const off = allocaOff.get(v);
            if (fits12(off)) emit(`addi ${r}, s0, ${off}`); else { emit(`li ${r}, ${off}`); emit(`add ${r}, s0, ${r}`); }
            return;
        }
        if (reg.has(v)) { if (reg.get(v) !== r) emit(`${fp ? 'fmv.s' : 'mv'} ${r}, ${reg.get(v)}`); return; }
        mem(fp ? 'flw' : 'lw', r, 's0', slotOf(v));
    }
    /** Registrador para ler o valor (o próprio, zero, ou um auxiliar carregado). */
    function src(v, k = 0) {
        if ((v.vk === 'const' || v.vk === 'undef') && v.ty !== 'float' && !v.v) return 'zero';
        if (isVal(v) && reg.has(v)) return reg.get(v);
        const r = isFloatTy(v.ty) ? [FSA, FTMP][k] : [SA, SB][k];
        put(v, r);
        return r;
    }
    /** Registrador para escrever o resultado e a função que conclui a escrita (guarda se derramado). */
    function dst(v) {
        const fp = isFloatTy(v.ty);
        if (reg.has(v)) return [reg.get(v), () => {}];
        const r = fp ? FSA : SA;
        return [r, () => { if (spilled.has(v)) mem(fp ? 'fsw' : 'sw', r, 's0', slotOf(v)); }];
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

    /** Cópias paralelas: [destino (valor da phi), origem], sem escrever nada antes de ler. */
    function parallelCopy(moves, phiOf) {
        const loc = (v) => (isVal(v) && reg.has(v) ? reg.get(v) : isVal(v) && spilled.has(v) ? `@${slotOf(v)}` : null);
        let pending = moves.map(([d, s]) => ({ d: loc(d), dv: d, s: loc(s), sv: s })).filter((m) => m.s === null || m.s !== m.d);
        const write = (m) => {
            setMeta(phiOf.get(m.dv));
            const fp = isFloatTy(m.dv.ty);
            if (m.d.startsWith('@')) {
                const r = m.s && !m.s.startsWith('@') ? m.s : (put(m.sv, fp ? FSA : SA), fp ? FSA : SA);
                if (m.s && m.s.startsWith('@')) { /* já carregado acima */ }
                mem(fp ? 'fsw' : 'sw', r, 's0', +m.d.slice(1));
            } else if (m.s && m.s.startsWith('@')) mem(fp ? 'flw' : 'lw', m.d, 's0', +m.s.slice(1));
            else if (m.s) emit(`${fp ? 'fmv.s' : 'mv'} ${m.d}, ${m.s}`);
            else put(m.sv, m.d);
        };
        while (pending.length) {
            const ready = pending.find((m) => !pending.some((o) => o !== m && o.s === m.d));
            if (ready) { write(ready); pending = pending.filter((m) => m !== ready); continue; }
            // Ciclo: guarda o valor atual de um destino num auxiliar e troca as leituras dele.
            const m = pending[0];
            const fp = isFloatTy(m.dv.ty);
            const t = fp ? FTMP : TMP;
            setMeta(phiOf.get(m.dv));
            if (m.d.startsWith('@')) mem(fp ? 'flw' : 'lw', t, 's0', +m.d.slice(1));
            else emit(`${fp ? 'fmv.s' : 'mv'} ${t}, ${m.d}`);
            for (const o of pending) if (o.s === m.d) o.s = t;
        }
    }

    function phiCopies(from, toLabel) {
        const to = byLabel.get(toLabel);
        const moves = [], phiOf = new Map();
        for (const i of to.insts) {
            if (i.op !== 'phi') continue;
            const inc = i.incoming.find(([, l]) => l === from.label);
            if (!inc || !(reg.has(i.dst) || spilled.has(i.dst))) continue;
            moves.push([i.dst, inc[0]]);
            phiOf.set(i.dst, i);
        }
        if (moves.length) parallelCopy(moves, phiOf);
    }

    // Prólogo do corpo: argumentos para os seus registradores (ou o quadro).
    meta = { src: F.line, node: F.sym.node.id, ir: null, fn: F.name };
    {
        const moves = [];
        for (const prm of F.params) {
            const v = prm.value, a = argReg.get(v);
            if (reg.has(v)) moves.push([reg.get(v), a, prm]);
            else if (spilled.has(v)) { mem(isFloatTy(prm.ty) ? 'fsw' : 'sw', a, 's0', slotOf(v)); body[body.length - 1].note = 'arg'; body[body.length - 1].noteArgs = { name: argName(prm) }; }
        }
        // Os destinos são t, s, ft ou fs e as origens a ou fa: não há conflito entre eles.
        for (const [r, a, prm] of moves) {
            if (r === a) continue;
            emit(`${r.startsWith('f') ? 'fmv.s' : 'mv'} ${r}, ${a}`);
            body[body.length - 1].note = 'argReg';
            body[body.length - 1].noteArgs = { name: argName(prm), reg: r };
        }
    }

    F.blocks.forEach((b, bi) => {
        if (bi > 0) emitLabel(`${label(b.label)}:`, { fn: F.name, block: b.label });
        const term = b.insts[b.insts.length - 1];
        const prev = b.insts[b.insts.length - 2];
        const fuse = prev && fused.has(prev);
        for (const i of b.insts) {
            if (i === term || (fuse && i === prev)) break;
            if (i.op === 'alloca' || i.op === 'phi') continue;
            setMeta(i);
            genInst(i);
        }
        if (term.op === 'br') phiCopies(b, term.target);
        if (term.op === 'condbr') { phiCopies(b, term.t); if (term.f !== term.t) phiCopies(b, term.f); }
        setMeta(term);
        if (fuse) {
            meta.ir2 = prev.irLine ?? null;
            if (opts.irComments) comment = `${instText(prev)}; ${instText(term)}`;
        }
        const next = (l) => blockIndex.get(l) === bi + 1;
        switch (term.op) {
            case 'br': if (!next(term.target)) emit(`j ${label(term.target)}`); break;
            case 'condbr': {
                if (fuse) {
                    const a = src(prev.a, 0), c = src(prev.b, 1);
                    if (next(term.f)) emit(`${BRANCH[prev.cond]} ${a}, ${c}, ${label(term.t)}`);
                    else {
                        emit(`${BRANCH[INVERT[prev.cond]]} ${a}, ${c}, ${label(term.f)}`);
                        if (!next(term.t)) emit(`j ${label(term.t)}`);
                    }
                    break;
                }
                const c = src(term.cond, 0);
                if (next(term.f)) emit(`bnez ${c}, ${label(term.t)}`);
                else { emit(`beqz ${c}, ${label(term.f)}`); if (!next(term.t)) emit(`j ${label(term.t)}`); }
                break;
            }
            case 'ret':
                if (term.val) put(term.val, isFloatTy(term.ty) ? 'fa0' : 'a0');
                if (bi !== F.blocks.length - 1) { emit(`j ${exitLabel}`); usedExit = true; }
                break;
            default: break;
        }
    });

    function genInst(i) {
        const d = i.dst;
        switch (i.op) {
            case 'load': {
                const [r, done] = dst(d);
                if (allocaSet.has(i.ptr)) mem(isFloatTy(i.ty) ? 'flw' : 'lw', r, 's0', allocaOff.get(i.ptr));
                else mem(isFloatTy(i.ty) ? 'flw' : 'lw', r, src(i.ptr, 1), 0);
                done();
                return;
            }
            case 'store': {
                const v = src(i.val, 0);
                if (allocaSet.has(i.ptr)) mem(isFloatTy(i.ty) ? 'fsw' : 'sw', v, 's0', allocaOff.get(i.ptr));
                else mem(isFloatTy(i.ty) ? 'fsw' : 'sw', v, src(i.ptr, 1), 0);
                return;
            }
            case 'add': case 'sub': case 'mul': case 'sdiv': case 'srem': case 'and': case 'or': case 'xor': case 'shl': case 'ashr': {
                const a = src(i.a, 0);
                const k = i.b.vk === 'const' ? i.b.v : null;
                const [r, done] = dst(d);
                if (i.exact && i.op === 'sdiv' && k === 4) { emit(`srai ${r}, ${a}, 2`); done(); return; }
                let imm = null;
                if (k !== null) {
                    if (i.op === 'sub' && fits12(-k)) imm = ['addi', -k];
                    else if ((i.op === 'shl' || i.op === 'ashr') && k >= 0 && k < 32) imm = [IIMM[i.op], k];
                    else if (IIMM[i.op] && i.op !== 'shl' && i.op !== 'ashr' && fits12(k)) imm = [IIMM[i.op], k];
                }
                if (imm) emit(`${imm[0]} ${r}, ${a}, ${imm[1]}`);
                else {
                    const b = src(i.b, 1);
                    emit(i.op === 'sub' && a === 'zero' ? `neg ${r}, ${b}` : `${IREG[i.op]} ${r}, ${a}, ${b}`);
                }
                done();
                return;
            }
            case 'fadd': case 'fsub': case 'fmul': case 'fdiv': {
                const a = src(i.a, 0), b = src(i.b, 1);
                const [r, done] = dst(d);
                emit(`${FOP[i.op]} ${r}, ${a}, ${b}`);
                done();
                return;
            }
            case 'fneg': { const a = src(i.a, 0); const [r, done] = dst(d); emit(`fneg.s ${r}, ${a}`); done(); return; }
            case 'icmp': {
                const a = src(i.a, 0);
                const k = i.b.vk === 'const' ? i.b.v : null;
                const sl = i.ty === 'ptr' ? 'sltu' : 'slt';
                const [r, done] = dst(d);
                if (k !== null && (i.cond === 'slt' || i.cond === 'ult') && fits12(k)) emit(`${sl}i ${r}, ${a}, ${k}`);
                else if (k === 0 && (i.cond === 'eq' || i.cond === 'ne')) emit(`${i.cond === 'eq' ? 'seqz' : 'snez'} ${r}, ${a}`);
                else {
                    const b = src(i.b, 1);
                    switch (i.cond) {
                        case 'eq': emit(`xor ${r}, ${a}, ${b}`); emit(`seqz ${r}, ${r}`); break;
                        case 'ne': emit(`xor ${r}, ${a}, ${b}`); emit(`snez ${r}, ${r}`); break;
                        case 'slt': case 'ult': emit(`${sl} ${r}, ${a}, ${b}`); break;
                        case 'sgt': case 'ugt': emit(`${sl} ${r}, ${b}, ${a}`); break;
                        case 'sle': case 'ule': emit(`${sl} ${r}, ${b}, ${a}`); emit(`xori ${r}, ${r}, 1`); break;
                        default: emit(`${sl} ${r}, ${a}, ${b}`); emit(`xori ${r}, ${r}, 1`); break;
                    }
                }
                done();
                return;
            }
            case 'fcmp': {
                const a = src(i.a, 0), b = src(i.b, 1);
                const [r, done] = dst(d);
                switch (i.cond) {
                    case 'oeq': emit(`feq.s ${r}, ${a}, ${b}`); break;
                    case 'une': emit(`feq.s ${r}, ${a}, ${b}`); emit(`xori ${r}, ${r}, 1`); break;
                    case 'olt': emit(`flt.s ${r}, ${a}, ${b}`); break;
                    case 'ole': emit(`fle.s ${r}, ${a}, ${b}`); break;
                    case 'ogt': emit(`flt.s ${r}, ${b}, ${a}`); break;
                    default: emit(`fle.s ${r}, ${b}, ${a}`); break;
                }
                done();
                return;
            }
            case 'zext': case 'ptrtoint': { const a = src(i.a, 0); const [r, done] = dst(d); if (r !== a) emit(`mv ${r}, ${a}`); done(); return; }
            case 'sitofp': { const a = src(i.a, 0); const [r, done] = dst(d); emit(`fcvt.s.w ${r}, ${a}`); done(); return; }
            case 'fptosi': { const a = src(i.a, 0); const [r, done] = dst(d); emit(`fcvt.w.s ${r}, ${a}, rtz`); done(); return; }
            case 'bitcast': {
                const a = src(i.a, 0);
                const [r, done] = dst(d);
                emit(i.to === 'float' ? `fmv.w.x ${r}, ${a}` : `fmv.x.w ${r}, ${a}`);
                done();
                return;
            }
            case 'gep': {
                const base = src(i.base, 0);
                const [r, done] = dst(d);
                if (i.index.vk === 'const') {
                    const off = 4 * i.index.v;
                    if (off === 0) { if (r !== base) emit(`mv ${r}, ${base}`); }
                    else if (fits12(off)) emit(`addi ${r}, ${base}, ${off}`);
                    else { emit(`li ${SB}, ${off}`); emit(`add ${r}, ${base}, ${SB}`); }
                } else {
                    const idx = src(i.index, 1);
                    emit(`slli ${SB}, ${idx}, 2`);
                    emit(`add ${r}, ${base}, ${SB}`);
                }
                done();
                return;
            }
            case 'call': {
                let ai = 0, af = 0;
                for (const a of i.args) put(a.val, isFloatTy(a.ty) ? `fa${af++}` : `a${ai++}`);
                emit(`jal ra, ${i.fn}`);
                if (d && (reg.has(d) || spilled.has(d))) {
                    const fp = isFloatTy(d.ty);
                    const [r, done] = dst(d);
                    emit(`${fp ? 'fmv.s' : 'mv'} ${r}, ${fp ? 'fa0' : 'a0'}`);
                    done();
                }
                return;
            }
            default: throw new Error(`codegen-ra: ${i.op}`);
        }
    }

    // Prólogo e epílogo.
    const size = Math.ceil(-bottom / 16) * 16;
    const fm = { src: F.line, node: F.sym.node.id, ir: null, fn: F.name };
    const em = { src: F.endLine, node: F.sym.node.id, ir: null, fn: F.name };
    emitLine('');
    emitLine(`${F.name}:`, { ...fm, fnLabel: F.name });
    const pro = (text, c, a = {}) => emitLine(`    ${text}`, { ...fm, note: c, noteArgs: a, prologue: true });
    if (fits12(size)) {
        pro(`addi sp, sp, -${size}`, 'pro.alloc');
        pro(`sw ra, ${size - 4}(sp)`, 'pro.ra');
        pro(`sw s0, ${size - 8}(sp)`, 'pro.s0');
        pro(`addi s0, sp, ${size}`, 'pro.fp');
    } else {
        pro(`mv ${SB}, sp`, 'pro.big');
        pro(`li ${SA}, ${size}`, null);
        pro(`sub sp, sp, ${SA}`, 'pro.alloc');
        pro(`sw ra, -4(${SB})`, 'pro.ra');
        pro(`sw s0, -8(${SB})`, 'pro.s0');
        pro(`mv s0, ${SB}`, 'pro.fp');
    }
    for (const [r, off] of calleeOff) pro(`${r.startsWith('f') ? 'fsw' : 'sw'} ${r}, ${off}(s0)`, 'pro.saved', { reg: r });
    for (const l of body) emitLine(l.text, l);
    if (usedExit) emitLine(`${exitLabel}:`, { ...em, block: 'exit' });
    const epi = (text, c, a = {}) => emitLine(`    ${text}`, { ...em, note: c, noteArgs: a, epilogue: true });
    for (const [r, off] of calleeOff) epi(`${r.startsWith('f') ? 'flw' : 'lw'} ${r}, ${off}(s0)`, 'epi.saved', { reg: r });
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
    const assignment = [...iv.values()].map((it) => ({ value: valueText(it.v), start: it.start, end: it.end, reg: reg.get(it.v) ?? null, spilled: spilled.has(it.v), cross: it.cross }));
    return { fn: F.name, size, slots: slots.map((s) => ({ ...s, spOff: s.off + size })), regalloc: assignment };
}

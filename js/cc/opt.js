/**
 * Otimizações sobre a IR na forma SSA (depois da mem2reg), como passagens do opt do LLVM.
 *
 * Clássicas (o resultado do programa não muda):
 *   const     propagação de constantes e de desvios: instrução com operandos constantes vira constante, desvio
 *             com condição constante vira incondicional e os blocos que ficam inalcançáveis saem (como sccp);
 *   simplify  simplificação algébrica e redução de força: x + 0, x * 1, x * 0, x - x, x * 2^k vira x << k;
 *   cse       eliminação de subexpressões comuns: uma instrução igual a outra que a domina é trocada por ela, e
 *             um load repetido no mesmo bloco, sem store ou chamada no meio, reaproveita o anterior (como gvn);
 *   licm      movimentação de código invariante: o que não muda dentro de um laço vai para o bloco antes dele;
 *   dce       eliminação de código morto: instrução sem efeito colateral cujo valor ninguém usa.
 *
 * Aproximadas (trocam exatidão por desempenho):
 *   perforate perfuração de laço: a variável de indução avança k passos de cada vez, pulando iterações;
 *   fprec     redução de precisão: o resultado de cada operação float tem a mantissa truncada para m bits;
 *   amul      multiplicação inteira aproximada: os k bits menos significativos dos operandos são zerados;
 *   aadd      soma e subtração inteiras aproximadas, com os somadores do axc-simulator: truncamento (os k bits
 *             menos significativos dos operandos zerados) ou LOA (os k bits baixos viram o OU dos operandos, e o
 *             E dos bits k-1 entra como vai-um na parte alta, que é exata). A subtração é a soma com o
 *             complemento do subtraendo, como numa unidade de soma e subtração.
 * As aproximações não tocam no que calcula endereços (getelementptr) nem condições de desvio, para que o
 * programa continue acessando a memória certa e terminando.
 *
 * Cada passagem registra o que fez (chave de mensagem e parâmetros), para a lista mostrada na interface.
 */
import { analyzeCfg, successors } from './cfg.js';
import { cloneFunction, instOperands } from './mem2reg.js';
import { evalPure } from './irinterp.js';
import { instText, valueText, cInt, cFloat, cBool } from './irgen.js';

const PURE = new Set(['add', 'sub', 'mul', 'sdiv', 'srem', 'and', 'or', 'xor', 'shl', 'ashr', 'fadd', 'fsub', 'fmul', 'fdiv',
    'fneg', 'icmp', 'fcmp', 'zext', 'ptrtoint', 'sitofp', 'fptosi', 'gep', 'bitcast']);
const OPS = ['a', 'b', 'ptr', 'val', 'base', 'index', 'cond'];
const isConst = (v) => v?.vk === 'const';
const constOf = (ty, x) => (ty === 'float' ? cFloat(x) : ty === 'i1' ? cBool(x) : cInt(x));
const sameConst = (a, b) => isConst(a) && isConst(b) && a.ty === b.ty && Object.is(a.v, b.v);

export const CLASSIC = ['const', 'simplify', 'cse', 'licm', 'dce'];

/** Troca todos os usos de um valor por outro. */
function replaceUses(F, from, to) {
    for (const b of F.blocks) {
        for (const i of b.insts) {
            for (const k of OPS) if (i[k] === from) i[k] = to;
            if (i.args) for (const a of i.args) if (a.val === from) a.val = to;
            if (i.incoming) for (const e of i.incoming) if (e[0] === from) e[0] = to;
        }
    }
}

function usesOf(F) {
    const n = new Map();
    for (const b of F.blocks) for (const i of b.insts) for (const v of instOperands(i)) if (v !== i.dst) n.set(v, (n.get(v) ?? 0) + 1);
    return n;
}

const T = (i) => instText(i);

/** Recalcula predecessores e tira blocos inalcançáveis (e as entradas de phi que vinham deles). */
function cleanupCfg(F, log) {
    const byLabel = new Map(F.blocks.map((b) => [b.label, b]));
    const reach = new Set([F.blocks[0].label]);
    const work = [F.blocks[0].label];
    while (work.length) for (const s of successors(byLabel.get(work.pop()))) if (!reach.has(s.to)) { reach.add(s.to); work.push(s.to); }
    const dead = F.blocks.filter((b) => !reach.has(b.label)).map((b) => b.label);
    if (dead.length && log) log.push({ pass: 'const', key: 'opt.unreachable', p: { blocks: dead.join(', ') } });
    F.blocks = F.blocks.filter((b) => reach.has(b.label));
    for (const b of F.blocks) b.preds = [];
    for (const b of F.blocks) for (const s of successors(b)) if (!byLabel.get(s.to).preds.includes(b.label)) byLabel.get(s.to).preds.push(b.label);
    for (const b of F.blocks) {
        for (const i of b.insts) if (i.op === 'phi') i.incoming = i.incoming.filter(([, l]) => b.preds.includes(l));
    }
}

// Propagação de constantes ----------------------------------------------------------------------------------

function constProp(F, log) {
    let changed = true, any = false;
    while (changed) {
        changed = false;
        for (const b of F.blocks) {
            for (const i of [...b.insts]) {
                if (i.op === 'phi') {
                    const vals = i.incoming.map(([v]) => v).filter((v) => v !== i.dst);
                    // Todas as entradas iguais (fora a própria phi): o valor domina o bloco e substitui a phi.
                    if (vals.length && vals.every((v) => v === vals[0] || sameConst(v, vals[0]))) {
                        log.push({ pass: 'const', key: 'opt.phi', p: { i: T(i), v: valueText(vals[0]) } });
                        replaceUses(F, i.dst, vals[0]);
                        b.insts.splice(b.insts.indexOf(i), 1);
                        changed = true;
                    }
                    continue;
                }
                if (!PURE.has(i.op) || i.op === 'gep' || i.op === 'ptrtoint') continue;
                const ops = [i.a, i.b].filter(Boolean);
                if (!ops.every(isConst) || i.dst.ty === 'ptr') continue;
                const r = evalPure(i, i.a?.v, i.b?.v);
                const c = constOf(i.dst.ty, r);
                log.push({ pass: 'const', key: 'opt.fold', p: { i: T(i), v: valueText(c) } });
                replaceUses(F, i.dst, c);
                b.insts.splice(b.insts.indexOf(i), 1);
                changed = true;
            }
            const term = b.insts[b.insts.length - 1];
            if (term?.op === 'condbr' && isConst(term.cond)) {
                const keep = term.cond.v ? term.t : term.f, drop = term.cond.v ? term.f : term.t;
                log.push({ pass: 'const', key: 'opt.branch', p: { b: b.label, to: keep } });
                b.insts[b.insts.length - 1] = { op: 'br', target: keep, line: term.line, node: term.node };
                if (drop !== keep) {
                    const d = F.blocks.find((x) => x.label === drop);
                    for (const i of d.insts) if (i.op === 'phi') i.incoming = i.incoming.filter(([, l]) => l !== b.label);
                }
                changed = true;
            }
        }
        if (changed) { any = true; cleanupCfg(F, log); }
    }
    if (mergeBlocks(F, log)) any = true;
    return any;
}

/** Junta um bloco ao único predecessor quando este só desvia para ele (como a simplifycfg). */
function mergeBlocks(F, log) {
    let any = false;
    for (let again = true; again;) {
        again = false;
        for (const a of F.blocks) {
            const term = a.insts[a.insts.length - 1];
            if (term?.op !== 'br') continue;
            const b = F.blocks.find((x) => x.label === term.target);
            if (!b || b === F.blocks[0] || b.preds.length !== 1 || b === a) continue;
            for (const i of b.insts.filter((x) => x.op === 'phi')) replaceUses(F, i.dst, i.incoming[0][0]);
            a.insts = [...a.insts.slice(0, -1), ...b.insts.filter((x) => x.op !== 'phi')];
            for (const c of F.blocks) for (const i of c.insts) if (i.op === 'phi') for (const e of i.incoming) if (e[1] === b.label) e[1] = a.label;
            F.blocks = F.blocks.filter((x) => x !== b);
            log.push({ pass: 'const', key: 'opt.merge', p: { a: a.label, b: b.label } });
            cleanupCfg(F, null);
            again = true;
            any = true;
            break;
        }
    }
    return any;
}

// Simplificação algébrica e redução de força ----------------------------------------------------------------

const isK = (v, k) => isConst(v) && v.v === k;
const log2 = (k) => (k > 0 && (k & (k - 1)) === 0 ? Math.log2(k) : -1);

function simplify(F, log) {
    let any = false;
    for (const b of F.blocks) {
        for (const i of [...b.insts]) {
            let to = null;
            const { a, b: c } = i;
            switch (i.op) {
                case 'add': case 'or': case 'xor':
                    if (i.ty === 'i1') break;
                    if (isK(c, 0)) to = a; else if (isK(a, 0)) to = c;
                    break;
                case 'sub': if (isK(c, 0)) to = a; else if (a === c) to = cInt(0); break;
                case 'mul':
                    if (isK(c, 1)) to = a; else if (isK(a, 1)) to = c;
                    else if (isK(c, 0) || isK(a, 0)) to = cInt(0);
                    else {
                        const [x, k] = isConst(c) ? [a, c.v] : isConst(a) ? [c, a.v] : [null, 0];
                        const s = x ? log2(k) : -1;
                        if (s > 0) {
                            log.push({ pass: 'simplify', key: 'opt.strength', p: { i: T(i), k: s } });
                            Object.assign(i, { op: 'shl', a: x, b: cInt(s) });
                            any = true;
                        }
                    }
                    break;
                case 'sdiv': if (isK(c, 1)) to = a; break;
                case 'and': if (isK(c, 0) || isK(a, 0)) to = cInt(0); else if (isK(c, -1)) to = a; else if (a === c) to = a; break;
                case 'shl': case 'ashr': if (isK(c, 0)) to = a; break;
                case 'fmul': if (isConst(c) && c.v === 1) to = a; else if (isConst(a) && a.v === 1) to = c; break;
                case 'fdiv': if (isConst(c) && c.v === 1) to = a; break;
                case 'icmp': if (a === c && i.ty !== 'ptr') { if (['eq', 'sle', 'sge', 'ule', 'uge'].includes(i.cond)) to = cBool(1); else to = cBool(0); } break;
                case 'gep': if (isK(i.index, 0)) to = i.base; break;
                default: break;
            }
            if (to) {
                log.push({ pass: 'simplify', key: 'opt.simplify', p: { i: T(i), v: valueText(to) } });
                replaceUses(F, i.dst, to);
                b.insts.splice(b.insts.indexOf(i), 1);
                any = true;
            }
        }
    }
    return any;
}

// Subexpressões comuns ------------------------------------------------------------------------------------------

function cse(F, log) {
    const cfg = analyzeCfg(F);
    const ids = new Map();
    const id = (v) => {
        if (isConst(v)) return `${v.ty}:${Object.is(v.v, -0) ? '-0' : v.v}`;
        if (v?.vk === 'global') return `@${v.name}`;
        if (!ids.has(v)) ids.set(v, `#${ids.size}`);
        return ids.get(v);
    };
    const COMM = new Set(['add', 'mul', 'and', 'or', 'xor', 'fadd', 'fmul']);
    const key = (i) => {
        let ops = [i.a, i.b, i.base, i.index].filter(Boolean).map(id);
        if (COMM.has(i.op)) ops = ops.sort();
        return `${i.op}|${i.cond ?? ''}|${i.ty ?? ''}|${i.elem ?? ''}|${i.from ?? ''}|${i.to ?? ''}|${ops.join(',')}`;
    };
    let any = false;
    const byLabel = new Map(F.blocks.map((b) => [b.label, b]));
    const visit = (label, scope) => {
        const table = new Map(scope);
        const b = byLabel.get(label);
        let loads = new Map();
        for (const i of [...b.insts]) {
            if (i.op === 'store' || i.op === 'call') { loads = new Map(); continue; }
            if (i.op === 'load') {
                const k = `${i.ty}|${id(i.ptr)}`;
                if (loads.has(k)) {
                    log.push({ pass: 'cse', key: 'opt.load', p: { i: T(i), v: valueText(loads.get(k)) } });
                    replaceUses(F, i.dst, loads.get(k));
                    b.insts.splice(b.insts.indexOf(i), 1);
                    any = true;
                } else loads.set(k, i.dst);
                continue;
            }
            if (!PURE.has(i.op)) continue;
            const k = key(i);
            if (table.has(k)) {
                log.push({ pass: 'cse', key: 'opt.cse', p: { i: T(i), v: valueText(table.get(k)) } });
                replaceUses(F, i.dst, table.get(k));
                b.insts.splice(b.insts.indexOf(i), 1);
                any = true;
            } else table.set(k, i.dst);
        }
        for (const c of cfg.children.get(label)) visit(c, table);
    };
    visit(F.blocks[0].label, new Map());
    return any;
}

// Código invariante de laço -------------------------------------------------------------------------------------

function licm(F, log) {
    let any = false;
    const cfg = analyzeCfg(F);
    const byLabel = new Map(F.blocks.map((b) => [b.label, b]));
    for (const loop of [...cfg.loops].sort((a, b) => a.blocks.length - b.blocks.length)) {
        const outside = cfg.pred.get(loop.header).filter((p) => !loop.body.has(p));
        if (outside.length !== 1) continue;
        const pre = byLabel.get(outside[0]);
        const preTerm = pre.insts[pre.insts.length - 1];
        if (preTerm.op !== 'br') continue;
        const defIn = new Set();
        for (const l of loop.blocks) for (const i of byLabel.get(l).insts) if (i.dst) defIn.add(i.dst);
        let moved = true;
        while (moved) {
            moved = false;
            for (const l of loop.blocks) {
                const b = byLabel.get(l);
                for (const i of [...b.insts]) {
                    if (!PURE.has(i.op)) continue;
                    if (![i.a, i.b, i.base, i.index].filter(Boolean).every((v) => !defIn.has(v))) continue;
                    b.insts.splice(b.insts.indexOf(i), 1);
                    pre.insts.splice(pre.insts.length - 1, 0, i);
                    defIn.delete(i.dst);
                    log.push({ pass: 'licm', key: 'opt.licm', p: { i: T(i), from: l, to: pre.label, h: loop.header } });
                    moved = true;
                    any = true;
                }
            }
        }
    }
    return any;
}

// Código morto ------------------------------------------------------------------------------------------------

function dce(F, log) {
    let any = false, again = true;
    while (again) {
        again = false;
        const uses = usesOf(F);
        for (const b of F.blocks) {
            for (const i of [...b.insts]) {
                const removable = PURE.has(i.op) || i.op === 'load' || i.op === 'phi';
                if (!removable || !i.dst || (uses.get(i.dst) ?? 0) > 0) continue;
                log.push({ pass: 'dce', key: 'opt.dce', p: { i: T(i) } });
                b.insts.splice(b.insts.indexOf(i), 1);
                again = true;
                any = true;
            }
        }
    }
    return any;
}

// Aproximações ------------------------------------------------------------------------------------------------

/** Valores que calculam endereços ou condições de desvio (não podem ser aproximados). */
function protectedValues(F) {
    const def = new Map();
    for (const b of F.blocks) for (const i of b.insts) if (i.dst) def.set(i.dst, i);
    const out = new Set();
    const st = [];
    for (const b of F.blocks) {
        for (const i of b.insts) {
            if (i.op === 'gep') st.push(i.base, i.index);
            if (i.op === 'load' || i.op === 'store') st.push(i.ptr);
            if (i.op === 'condbr') st.push(i.cond);
        }
    }
    while (st.length) {
        const v = st.pop();
        if (!v || out.has(v)) continue;
        out.add(v);
        const d = def.get(v);
        if (d && d.op !== 'load' && d.op !== 'call') st.push(...instOperands(d));
    }
    return out;
}

/**
 * Laços que a perfuração aceita: variável de indução com passo constante e saída por comparação de ordem.
 * @returns {Array<{fn, header, phi, name, step, line}>}
 */
export function perforableLoops(module) {
    const out = [];
    for (const F of module.functions) {
        const cfg = analyzeCfg(F);
        const byLabel = new Map(F.blocks.map((b) => [b.label, b]));
        const def = new Map();
        for (const b of F.blocks) for (const i of b.insts) if (i.dst) def.set(i.dst, { i, b: b.label });
        for (const loop of cfg.loops) {
            const head = byLabel.get(loop.header);
            const term = head.insts[head.insts.length - 1];
            if (term.op !== 'condbr') continue;
            const cmp = def.get(term.cond)?.i;
            if (!cmp || cmp.op !== 'icmp' || ['eq', 'ne'].includes(cmp.cond)) continue;
            for (const phi of head.insts.filter((i) => i.op === 'phi' && i.ty === 'i32')) {
                const back = phi.incoming.filter(([, l]) => loop.body.has(l));
                if (back.length !== 1) continue;
                const upd = def.get(back[0][0]);
                if (!upd || !loop.body.has(upd.b) || !['add', 'sub'].includes(upd.i.op)) continue;
                const u = upd.i;
                const step = u.a === phi.dst && isConst(u.b) ? u.b.v * (u.op === 'sub' ? -1 : 1) : u.op === 'add' && u.b === phi.dst && isConst(u.a) ? u.a.v : 0;
                if (!step) continue;
                if (![cmp.a, cmp.b].includes(phi.dst) && ![cmp.a, cmp.b].includes(back[0][0])) continue;
                out.push({ fn: F.name, header: loop.header, phi: valueText(phi.dst), name: (phi.dst.name ?? '').replace(/\.\d+$/, ''), step, line: u.line, depth: loop.depth });
            }
        }
    }
    return out;
}

function perforate(F, header, k, log) {
    const cand = perforableLoops({ functions: [F] }).find((c) => c.header === header);
    if (!cand) return false;
    const head = F.blocks.find((b) => b.label === header);
    const phi = head.insts.find((i) => i.op === 'phi' && valueText(i.dst) === cand.phi);
    const cfg = analyzeCfg(F);
    const loop = cfg.loops.find((l) => l.header === header);
    const v = phi.incoming.find(([, l]) => loop.body.has(l))[0];
    for (const b of F.blocks) {
        const u = b.insts.find((i) => i.dst === v);
        if (!u) continue;
        const before = T(u);
        if (isConst(u.b)) u.b = cInt(u.b.v * k); else u.a = cInt(u.a.v * k);
        log.push({ pass: 'perforate', key: 'opt.perforate', p: { i: before, now: T(u), h: header, k } });
        return true;
    }
    return false;
}

function reducePrecision(F, bits, log) {
    const prot = protectedValues(F);
    const mask = bits >= 23 ? -1 : ~((1 << (23 - bits)) - 1);
    let n = 0;
    for (const b of F.blocks) {
        for (const i of [...b.insts]) {
            if (!['fadd', 'fsub', 'fmul', 'fdiv', 'sitofp'].includes(i.op) || prot.has(i.dst)) continue;
            const base = valueText(i.dst).slice(1);
            const raw = { vk: 'temp', ty: 'i32', name: `${base}.bits` };
            const cut = { vk: 'temp', ty: 'i32', name: `${base}.cut` };
            const res = { vk: 'temp', ty: 'float', name: `${base}.approx` };
            const at = b.insts.indexOf(i) + 1;
            replaceUses(F, i.dst, res);
            const meta = { line: i.line, node: i.node };
            b.insts.splice(at, 0,
                { op: 'bitcast', dst: raw, a: i.dst, from: 'float', to: 'i32', ...meta },
                { op: 'and', dst: cut, ty: 'i32', a: raw, b: cInt(mask), ...meta },
                { op: 'bitcast', dst: res, a: cut, from: 'i32', to: 'float', ...meta });
            n++;
        }
    }
    if (n) log.push({ pass: 'fprec', key: 'opt.fprec', p: { n, bits, fn: F.name } });
    return n > 0;
}

function approxMul(F, k, log) {
    const prot = protectedValues(F);
    const mask = ~((1 << k) - 1);
    let n = 0;
    for (const b of F.blocks) {
        for (const i of [...b.insts]) {
            if (i.op !== 'mul' || i.ty !== 'i32' || prot.has(i.dst)) continue;
            const before = T(i);
            for (const side of ['a', 'b']) {
                const v = i[side];
                if (isConst(v)) { i[side] = cInt(v.v & mask); continue; }
                const m = { vk: 'temp', ty: 'i32', name: `${valueText(i.dst).slice(1)}.${side === 'a' ? 'x' : 'y'}` };
                b.insts.splice(b.insts.indexOf(i), 0, { op: 'and', dst: m, ty: 'i32', a: v, b: cInt(mask), line: i.line, node: i.node });
                i[side] = m;
            }
            log.push({ pass: 'amul', key: 'opt.amul', p: { i: before, k } });
            n++;
        }
    }
    return n > 0;
}

/**
 * Soma aproximada em 32 bits, igual à função do somador do axc-simulator com a parte alta exata.
 * @param {'trunc'|'loa'} kind
 */
export function approxAddValue(kind, k, a, b) {
    if (!k) return (a + b) | 0;
    if (kind === 'trunc') return ((a & ~((1 << k) - 1)) + (b & ~((1 << k) - 1))) | 0;
    const cin = (a >> (k - 1)) & (b >> (k - 1)) & 1;
    return ((((a >> k) + (b >> k) + cin) << k) | ((a | b) & ((1 << k) - 1))) | 0;
}

function approxAdd(F, { kind, k }, log) {
    const prot = protectedValues(F);
    const low = (1 << k) - 1;
    let n = 0;
    for (const b of F.blocks) {
        for (const i of [...b.insts]) {
            if (!['add', 'sub'].includes(i.op) || i.ty !== 'i32' || prot.has(i.dst)) continue;
            const before = T(i);
            const meta = { line: i.line, node: i.node };
            const base = valueText(i.dst).slice(1);
            let t = 0;
            const emit = (op, x, y) => {
                if (isConst(x) && isConst(y)) return cInt(op === 'ashr' ? x.v >> y.v : op === 'shl' ? x.v << y.v : op === 'and' ? x.v & y.v
                    : op === 'or' ? x.v | y.v : op === 'xor' ? x.v ^ y.v : (x.v + y.v) | 0);
                if (isConst(x) && op !== 'ashr' && op !== 'shl') [x, y] = [y, x];
                const d = { vk: 'temp', ty: 'i32', name: `${base}.a${t++}` };
                b.insts.splice(b.insts.indexOf(i), 0, { op, dst: d, ty: 'i32', a: x, b: y, ...meta });
                return d;
            };
            if (kind === 'trunc') {
                i.a = emit('and', i.a, cInt(~low));
                i.b = emit('and', i.b, cInt(~low));
            } else {
                const x = i.a, y = i.op === 'sub' ? emit('xor', i.b, cInt(-1)) : i.b;
                const lo = emit('and', emit('or', x, y), cInt(low));
                const cin = emit('and', emit('and', emit('ashr', x, cInt(k - 1)), emit('ashr', y, cInt(k - 1))), cInt(1));
                const hi = emit('shl', emit('add', emit('add', emit('ashr', x, cInt(k)), emit('ashr', y, cInt(k))), cin), cInt(k));
                Object.assign(i, { op: 'or', a: hi, b: lo });
            }
            log.push({ pass: 'aadd', key: `opt.aadd.${kind}`, p: { i: before, k, b: k - 1 } });
            n++;
        }
    }
    return n > 0;
}

/**
 * Aplica as passagens escolhidas a uma cópia do módulo em SSA.
 * @param {object} module saída da mem2reg
 * @param {{classic?: string[], perforate?: {fn, header, k}|null, fprec?: number|null, amul?: number|null, aadd?: {kind: 'trunc'|'loa', k: number}|null}} opts
 * @returns {{module: object, log: Array}}
 */
export function optimize(module, opts = {}) {
    const classic = new Set(opts.classic ?? []);
    const log = [];
    const functions = module.functions.map((F0) => {
        const F = cloneFunction(F0);
        for (let round = 0; round < 3; round++) {
            let ch = false;
            if (classic.has('const')) ch = constProp(F, log) || ch;
            if (classic.has('simplify')) ch = simplify(F, log) || ch;
            if (classic.has('cse')) ch = cse(F, log) || ch;
            if (classic.has('licm')) ch = licm(F, log) || ch;
            if (classic.has('dce')) ch = dce(F, log) || ch;
            if (!ch) break;
        }
        if (opts.perforate && opts.perforate.fn === F.name && opts.perforate.k > 1) perforate(F, opts.perforate.header, opts.perforate.k, log);
        if (opts.fprec !== null && opts.fprec !== undefined && opts.fprec < 23) reducePrecision(F, opts.fprec, log);
        if (opts.amul) approxMul(F, opts.amul, log);
        if (opts.aadd?.k > 0) approxAdd(F, opts.aadd, log);
        if (classic.has('dce')) dce(F, log);
        cleanupCfg(F, null);
        return F;
    });
    return { module: { globals: module.globals.map((g) => ({ ...g })), functions }, log };
}

/**
 * Erro das saídas (retorno de main e variáveis globais) em relação às da versão exata.
 * @returns {{same: boolean, mre: number, maxAbs: number, n: number, finished: boolean}}
 */
export function outputError(ref, out) {
    if (out.reason !== 'end') return { same: false, mre: Infinity, maxAbs: Infinity, n: 0, finished: false };
    const a = [ref.ret, ...[...ref.globals.values()].flat()];
    const b = [out.ret, ...[...out.globals.values()].flat()];
    let sum = 0, maxAbs = 0, same = true;
    a.forEach((x, k) => {
        const y = b[k];
        if (Object.is(x, y) || (Number.isNaN(x) && Number.isNaN(y))) return;
        same = false;
        const d = Math.abs(x - y);
        maxAbs = Math.max(maxAbs, Number.isNaN(d) ? Infinity : d);
        sum += x === 0 ? Math.min(1, d) : Math.min(1, d / Math.abs(x));
    });
    return { same, mre: sum / a.length, maxAbs, n: a.length, finished: true };
}

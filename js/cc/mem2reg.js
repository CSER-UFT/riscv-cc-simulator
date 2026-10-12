/**
 * Promoção de variáveis da memória para registradores (a passagem mem2reg do LLVM), que leva a IR à forma SSA.
 *
 * Uma alloca é promovível quando só é usada como endereço de load e store (vetores e variáveis com o endereço
 * tomado, como em &x, ficam na memória). Para cada variável promovível:
 *   1. os blocos com store são as definições;
 *   2. uma phi é posta em cada bloco da fronteira de dominância iterada das definições em que a variável está
 *      viva na entrada (SSA podada, como no LLVM);
 *   3. um percurso da árvore de dominadores renomeia: cada load passa a usar o valor que chega naquele ponto,
 *      cada store vira o novo valor corrente, e cada phi recebe o valor que sai de cada predecessor.
 * As phi recebem o nome da variável com um número de versão (%i.0), como no LLVM. Um load sem store antes lê
 * um valor indefinido (undef).
 */
import { analyzeCfg, iteratedDF } from './cfg.js';

const isValue = (v) => v && (v.vk === 'temp' || v.vk === 'arg');
const OPERANDS = ['a', 'b', 'ptr', 'val', 'base', 'index', 'cond'];

/** Cópia independente de uma função da IR (valores e instruções novos). */
export function cloneFunction(F) {
    const m = new Map();
    const nv = (v) => { if (!m.has(v)) m.set(v, { ...v }); return m.get(v); };
    for (const p of F.params) nv(p.value);
    for (const b of F.blocks) for (const i of b.insts) if (i.dst) nv(i.dst);
    const V = (v) => (isValue(v) ? nv(v) : v);
    const instMap = new Map();
    const blocks = F.blocks.map((b) => ({
        label: b.label, preds: [...b.preds],
        insts: b.insts.map((i) => {
            const c = { ...i };
            for (const k of OPERANDS) if (k in c) c[k] = V(c[k]);
            if (c.dst) c.dst = V(c.dst);
            if (c.args) c.args = c.args.map((a) => ({ ...a, val: V(a.val) }));
            if (c.incoming) c.incoming = c.incoming.map(([v, l]) => [V(v), l]);
            delete c.irLine;
            instMap.set(i, c);
            return c;
        }),
    }));
    return {
        ...F, blocks,
        params: F.params.map((p) => ({ ...p, value: V(p.value) })),
        allocas: F.allocas.map((a) => instMap.get(a)),
    };
}

/** Operandos de uma instrução (inclusive as entradas de phi e os argumentos de chamada). */
export function instOperands(i) {
    const out = [];
    for (const k of OPERANDS) if (i[k]) out.push(i[k]);
    if (i.args) for (const a of i.args) out.push(a.val);
    if (i.incoming) for (const [v] of i.incoming) out.push(v);
    return out;
}

function replaceOperands(F, resolve) {
    for (const b of F.blocks) {
        for (const i of b.insts) {
            for (const k of OPERANDS) if (i[k]) i[k] = resolve(i[k]);
            if (i.args) for (const a of i.args) a.val = resolve(a.val);
            if (i.incoming) i.incoming = i.incoming.map(([v, l]) => [resolve(v), l]);
        }
    }
}

/**
 * Aplica a mem2reg a uma cópia da função.
 * @returns {{F: object, promoted: Array<{name, phis: string[]}>, kept: string[]}}
 */
export function mem2reg(F0) {
    const F = cloneFunction(F0);
    const cfg = analyzeCfg(F);
    const allocas = F.allocas;
    const users = new Map(allocas.map((a) => [a.dst, []]));
    let promotable = new Set(allocas.filter((a) => !a.allocTy.startsWith('[')).map((a) => a.dst));
    for (const b of F.blocks) {
        for (const i of b.insts) {
            for (const k of OPERANDS) {
                const v = i[k];
                if (!users.has(v)) continue;
                users.get(v).push(i);
                const ok = (i.op === 'load' && k === 'ptr') || (i.op === 'store' && k === 'ptr');
                if (!ok) promotable.delete(v);
            }
            if (i.args) for (const a of i.args) promotable.delete(a.val);
            if (i.incoming) for (const [v] of i.incoming) promotable.delete(v);
        }
    }
    const blockOf = new Map();
    for (const b of F.blocks) for (const i of b.insts) blockOf.set(i, b.label);

    // Inserção das phi: fronteira de dominância iterada, podada pela vivacidade na entrada.
    const phiOf = new Map();   // bloco -> [{phi, addr}]
    const info = [];
    for (const a of allocas) {
        const addr = a.dst;
        if (!promotable.has(addr)) continue;
        const defBlocks = new Set(), liveIn = new Set();
        for (const b of F.blocks) {
            const first = b.insts.find((i) => i.ptr === addr && (i.op === 'load' || i.op === 'store'));
            if (!first) continue;
            if (b.insts.some((i) => i.op === 'store' && i.ptr === addr)) defBlocks.add(b.label);
            if (first.op === 'load') liveIn.add(b.label);
        }
        const work = [...liveIn];
        while (work.length) {
            const b = work.pop();
            for (const p of cfg.pred.get(b)) {
                if (defBlocks.has(p) || liveIn.has(p)) continue;
                liveIn.add(p);
                work.push(p);
            }
        }
        const phiBlocks = [...iteratedDF(cfg, defBlocks)].filter((b) => liveIn.has(b));
        phiBlocks.sort((x, y) => cfg.index.get(x) - cfg.index.get(y));
        let version = 0;
        const names = [];
        for (const pb of phiBlocks) {
            const name = `${addr.name}.${version++}`;
            const phi = { op: 'phi', ty: a.allocTy, dst: { vk: 'temp', ty: a.allocTy, name }, incoming: [], fromAlloca: addr, line: null, node: null };
            if (!phiOf.has(pb)) phiOf.set(pb, []);
            phiOf.get(pb).push({ phi, addr });
            names.push(name);
        }
        info.push({ name: a.sym?.name ?? addr.name, addr, phis: names });
    }

    // Renomeação pela árvore de dominadores.
    const replace = new Map();
    const undef = (ty) => ({ vk: 'undef', ty });
    const tyOf = new Map(allocas.map((a) => [a.dst, a.allocTy]));
    const byLabel = new Map(F.blocks.map((b) => [b.label, b]));
    const removed = new Set();
    const visit = (label, incoming) => {
        const cur = new Map(incoming);
        for (const { phi, addr } of phiOf.get(label) ?? []) cur.set(addr, phi.dst);
        for (const i of byLabel.get(label).insts) {
            if (i.op === 'load' && promotable.has(i.ptr)) {
                replace.set(i.dst, cur.get(i.ptr) ?? undef(tyOf.get(i.ptr)));
                removed.add(i);
            } else if (i.op === 'store' && promotable.has(i.ptr)) {
                cur.set(i.ptr, i.val);
                removed.add(i);
            }
        }
        for (const s of cfg.succ.get(label)) {
            for (const { phi, addr } of phiOf.get(s.to) ?? []) {
                if (!phi.incoming.some(([, l]) => l === label)) phi.incoming.push([cur.get(addr) ?? undef(phi.ty), label]);
            }
        }
        for (const c of cfg.children.get(label)) visit(c, cur);
    };
    visit(F.blocks[0].label, new Map());

    // Monta os blocos: phi novas no início, sem as allocas promovidas nem os loads e stores removidos.
    for (const b of F.blocks) {
        const rest = b.insts.filter((i) => !removed.has(i) && !(i.op === 'alloca' && promotable.has(i.dst)));
        const firstReal = rest.find((i) => i.op !== 'phi') ?? rest[0];
        const phis = (phiOf.get(b.label) ?? []).map(({ phi }) => {
            phi.line = firstReal?.line ?? null;
            phi.node = firstReal?.node ?? null;
            phi.incoming.sort((x, y) => b.preds.indexOf(x[1]) - b.preds.indexOf(y[1]));
            return phi;
        });
        b.insts = [...phis, ...rest];
    }
    F.allocas = F.allocas.filter((a) => !promotable.has(a.dst));

    const resolve = (v) => { let x = v; while (replace.has(x)) x = replace.get(x); return x; };
    replaceOperands(F, resolve);

    // Simplificação: phi cujas entradas são todas o mesmo valor (ou ela mesma) e phi sem uso.
    const inserted = new Set([...phiOf.values()].flat().map((x) => x.phi));
    for (let again = true; again;) {
        again = false;
        for (const b of F.blocks) {
            for (const i of b.insts) {
                if (!inserted.has(i)) continue;
                const vals = [...new Set(i.incoming.map(([v]) => v).filter((v) => v !== i.dst))];
                if (vals.length === 1) {
                    replace.set(i.dst, vals[0]);
                    b.insts = b.insts.filter((x) => x !== i);
                    inserted.delete(i);
                    again = true;
                }
            }
        }
        if (again) replaceOperands(F, resolve);
        const used = new Set();
        for (const b of F.blocks) for (const i of b.insts) for (const v of instOperands(i)) if (v !== i.dst) used.add(v);
        for (const b of F.blocks) {
            const before = b.insts.length;
            b.insts = b.insts.filter((i) => !inserted.has(i) || used.has(i.dst));
            if (b.insts.length !== before) again = true;
        }
        for (const i of [...inserted]) if (!F.blocks.some((b) => b.insts.includes(i))) inserted.delete(i);
    }
    const alive = new Set([...inserted].map((i) => i.dst.name));
    for (const x of info) x.phis = x.phis.filter((n) => alive.has(n));
    return { F, promoted: info, kept: F.allocas.map((a) => a.sym?.name ?? a.dst.name) };
}

/** Aplica a mem2reg a todas as funções do módulo. */
export function mem2regModule(module) {
    const results = module.functions.map((F) => mem2reg(F));
    return {
        module: { globals: module.globals.map((g) => ({ ...g })), functions: results.map((r) => r.F) },
        report: results.map((r, k) => ({ fn: module.functions[k].name, promoted: r.promoted, kept: r.kept })),
    };
}

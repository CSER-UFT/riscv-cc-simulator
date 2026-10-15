/**
 * Grafo de fluxo de dados (DFG) de um bloco básico e cadeias de definição e uso de uma função.
 *
 * Os nós são as instruções do bloco; uma aresta de dados liga quem define um valor a quem o usa, e uma aresta
 * de memória mantém a ordem entre acessos que podem tocar o mesmo endereço (store antes de load, load antes de
 * store, store antes de store e chamadas, que podem ler e escrever qualquer variável cujo endereço escapou).
 * Com uma latência para cada classe de instrução (as mesmas do simulador de processadores), o escalonamento
 * mais cedo possível (ASAP) dá o caminho crítico: o tempo mínimo do bloco com recursos ilimitados.
 */
import { instText, valueText } from './irgen.js';
import { instOperands } from './mem2reg.js';

/** Latências padrão, em ciclos (as do Simulador de Processadores RISC-V). */
export const LATENCY = { alu: 1, mul: 4, div: 10, load: 2, store: 1, fadd: 2, fmul: 5, fdiv: 10, branch: 1, call: 1, phi: 0 };

export function opClass(op) {
    switch (op) {
        case 'phi': return 'phi';
        case 'load': return 'load';
        case 'store': return 'store';
        case 'add': case 'sub': return 'add';
        case 'mul': return 'mul';
        case 'sdiv': case 'srem': return 'div';
        case 'fadd': case 'fsub': case 'fcmp': case 'sitofp': case 'fptosi': case 'fneg': return 'fadd';
        case 'fmul': return 'fmul';
        case 'fdiv': return 'fdiv';
        case 'br': case 'condbr': case 'ret': return 'branch';
        case 'call': return 'call';
        default: return 'alu';
    }
}

/** Instruções que definem cada valor na função. */
function definitions(F) {
    const def = new Map();
    for (const b of F.blocks) for (const i of b.insts) if (i.dst) def.set(i.dst, { inst: i, block: b.label });
    return def;
}

/** Variáveis na memória (allocas) cujo endereço escapa: guardado, passado a uma função ou usado numa phi. */
function escapedAllocas(F, def) {
    const allocas = new Set(F.allocas.map((a) => a.dst));
    const root = (v) => {
        let x = v;
        for (let k = 0; k < 50 && x; k++) {
            if (allocas.has(x)) return x;
            const d = def.get(x)?.inst;
            if (!d || d.op !== 'gep') return null;
            x = d.base;
        }
        return null;
    };
    const out = new Set();
    for (const b of F.blocks) {
        for (const i of b.insts) {
            const leaks = [];
            if (i.op === 'store') leaks.push(i.val);
            if (i.args) leaks.push(...i.args.map((a) => a.val));
            if (i.incoming) leaks.push(...i.incoming.map(([v]) => v));
            if (i.op === 'ret' && i.val) leaks.push(i.val);
            for (const v of leaks) { const r = root(v); if (r) out.add(r); }
        }
    }
    return { escaped: out, root };
}

/**
 * DFG de um bloco.
 * @returns {{nodes: Array, inputs: Array, edges: Array, length: number, seqSum: number}}
 */
export function blockDfg(F, label, lat = LATENCY, { opsOnly = false } = {}) {
    const b = F.blocks.find((x) => x.label === label);
    const def = definitions(F);
    const { escaped, root } = escapedAllocas(F, def);
    let insts = b.insts.filter((i) => i.op !== 'alloca');
    // Só as operações: sem load, store e cálculo de endereço. O valor lido vira uma entrada do bloco, o valor
    // guardado fica marcado como saída para a memória, e somem as instruções que só serviam aos endereços.
    const fromMem = new Set(), toMem = new Set();
    if (opsOnly) {
        const removed = new Set(insts.filter((i) => ['load', 'store', 'gep'].includes(i.op)));
        for (const i of removed) {
            if (i.op === 'load') fromMem.add(i.dst);
            if (i.op === 'store' && i.val && (i.val.vk === 'temp' || i.val.vk === 'arg')) toMem.add(i.val);
        }
        const usesOf = new Map();
        for (const bb of F.blocks) for (const i of bb.insts) {
            const ops = i.op === 'phi' ? i.incoming.map(([v]) => v) : instOperands(i);
            for (const v of ops) { if (!usesOf.has(v)) usesOf.set(v, []); usesOf.get(v).push(i); }
        }
        // Remove, até estabilizar, o que só serve para endereços: usado por instruções removidas ou, em outro
        // bloco, como índice ou base de um getelementptr ou endereço de um load ou store (não o valor guardado).
        const addrUse = (u, v) => removed.has(u) || u.op === 'gep' || u.op === 'load' || (u.op === 'store' && u.val !== v);
        for (let changed = true; changed;) {
            changed = false;
            for (const i of insts) {
                if (removed.has(i) || !i.dst || ['call', 'phi'].includes(i.op) || toMem.has(i.dst)) continue;
                const us = usesOf.get(i.dst) ?? [];
                if (us.length && us.every((u) => addrUse(u, i.dst))) { removed.add(i); changed = true; }
            }
        }
        insts = insts.filter((i) => !removed.has(i));
    }
    const nodes = insts.map((inst, k) => {
        const cls = opClass(inst.op);
        // Soma e subtração usam a latência da ULA, a não ser que haja uma própria (somador aproximado).
        const l = cls === 'add' ? lat.add ?? lat.alu ?? LATENCY.alu : lat[cls] ?? LATENCY[cls] ?? 1;
        return { id: k, inst, cls, lat: l, text: instText(inst), preds: [], succs: [], toMem: !!inst.dst && toMem.has(inst.dst) };
    });
    const local = new Map();
    nodes.forEach((n) => { if (n.inst.dst) local.set(n.inst.dst, n.id); });
    const allocas = new Set(F.allocas.map((a) => a.dst));
    const inputs = [], inputIdx = new Map(), edges = [];
    const addEdge = (from, to, kind) => {
        if (edges.some((e) => e.from === from && e.to === to)) return;
        edges.push({ from, to, kind });
        nodes[to].preds.push(from);
        nodes[from].succs.push(to);
    };
    for (const n of nodes) {
        const ops = n.inst.op === 'phi' ? n.inst.incoming.map(([v]) => v) : instOperands(n.inst);
        for (const v of ops) {
            if (!v || (v.vk !== 'temp' && v.vk !== 'arg') || allocas.has(v)) continue;
            if (n.inst.op !== 'phi' && local.has(v) && local.get(v) < n.id) addEdge(local.get(v), n.id, 'data');
            else {
                if (!inputIdx.has(v)) { inputIdx.set(v, inputs.length); inputs.push({ value: v, text: fromMem.has(v) ? `${valueText(v)} (load)` : valueText(v), fromMem: fromMem.has(v), to: [] }); }
                const inp = inputs[inputIdx.get(v)];
                if (!inp.to.includes(n.id)) inp.to.push(n.id);
            }
        }
    }
    // Dependências de memória entre acessos que podem ser ao mesmo endereço.
    const obj = (p) => {
        if (!p) return '?';
        if (p.vk === 'global') return `@${p.name}`;
        const r = root(p);
        if (r) return `%${r.name}`;
        return '?';
    };
    const mems = nodes.filter((n) => ['load', 'store', 'call'].includes(n.inst.op)).map((n) => ({
        n, write: n.inst.op !== 'load', call: n.inst.op === 'call', o: n.inst.op === 'call' ? '*' : obj(n.inst.ptr),
    }));
    const isPrivate = (o) => o.startsWith('%') && ![...escaped].some((e) => `%${e.name}` === o);
    const alias = (x, y) => {
        if (x.call || y.call) return !(isPrivate(x.o) || isPrivate(y.o)) || (x.call && y.call);
        if (x.o === '?' || y.o === '?') return !(isPrivate(x.o) || isPrivate(y.o));
        return x.o === y.o;
    };
    for (let j = 0; j < mems.length; j++) {
        for (let i = 0; i < j; i++) {
            const x = mems[i], y = mems[j];
            if ((x.write || y.write) && alias(x, y)) addEdge(x.n.id, y.n.id, 'mem');
        }
    }
    // Redução transitiva das arestas de memória (uma aresta implícita por outro caminho não é desenhada).
    const reach = (from, to, skip) => {
        const seen = new Set(), st = [from];
        while (st.length) {
            const u = st.pop();
            for (const e of edges) {
                if (e.from !== u || e === skip || seen.has(e.to)) continue;
                if (e.to === to) return true;
                seen.add(e.to);
                st.push(e.to);
            }
        }
        return false;
    };
    for (const e of [...edges]) {
        if (e.kind !== 'mem' || !reach(e.from, e.to, e)) continue;
        edges.splice(edges.indexOf(e), 1);
        nodes[e.to].preds.splice(nodes[e.to].preds.indexOf(e.from), 1);
        nodes[e.from].succs.splice(nodes[e.from].succs.indexOf(e.to), 1);
    }

    // Escalonamento mais cedo (ASAP) e mais tarde (ALAP), folga e caminho crítico.
    for (const n of nodes) n.start = Math.max(0, ...n.preds.map((p) => nodes[p].start + nodes[p].lat));
    const length = Math.max(0, ...nodes.map((n) => n.start + n.lat));
    for (const n of [...nodes].reverse()) n.alap = Math.min(length - n.lat, ...n.succs.map((s) => nodes[s].alap - n.lat));
    for (const n of nodes) { n.slack = n.alap - n.start; n.critical = n.slack === 0; }
    for (const e of edges) e.critical = nodes[e.from].critical && nodes[e.to].critical && nodes[e.from].start + nodes[e.from].lat === nodes[e.to].start;
    return { label, nodes, inputs, edges, length, seqSum: nodes.reduce((s, n) => s + n.lat, 0) };
}

/** Cadeias de definição e uso de todos os valores de uma função. */
export function defUse(F) {
    const rows = [];
    const at = new Map();
    for (const p of F.params) at.set(p.value, { value: p.value, def: { block: null, inst: null }, uses: [] });
    for (const b of F.blocks) for (const i of b.insts) if (i.dst && i.op !== 'alloca') at.set(i.dst, { value: i.dst, def: { block: b.label, inst: i }, uses: [] });
    for (const b of F.blocks) {
        for (const i of b.insts) {
            if (i.op === 'phi') {
                for (const [v, l] of i.incoming) at.get(v)?.uses.push({ block: b.label, inst: i, from: l });
            } else {
                for (const v of instOperands(i)) at.get(v)?.uses.push({ block: b.label, inst: i });
            }
        }
    }
    for (const r of at.values()) rows.push(r);
    return rows;
}

/** Classe de unidade funcional de cada classe de instrução, no escalonamento com recursos (estilo HLS). */
export const UNIT_OF = { alu: 'alu', add: 'alu', branch: 'alu', mul: 'mul', div: 'mul', load: 'mem', store: 'mem', call: 'mem', fadd: 'fpu', fmul: 'fpu', fdiv: 'fpu', phi: null };
export const UNITS = ['alu', 'mul', 'mem', 'fpu'];

/**
 * Escalonamento por lista com recursos limitados, como na síntese de alto nível: a cada passo de controle,
 * as instruções prontas disputam as unidades da sua classe; tem prioridade a de menor início ALAP (menor folga).
 * Com unidades em pipeline, uma unidade aceita uma operação nova a cada passo; sem pipeline, fica ocupada
 * durante toda a latência.
 * @param {object} g saída de blockDfg
 * @param {{alu: number, mul: number, mem: number, fpu: number}} res
 * @returns {object} cópia de g com start, unit e length do escalonamento
 */
export function listSchedule(g, res, { pipelined = false } = {}) {
    const nodes = g.nodes.map((n) => ({ ...n }));
    const busy = Object.fromEntries(UNITS.map((u) => [u, Array.from({ length: Math.max(1, res[u] ?? 1) }, () => -1)]));
    const done = new Set();
    // O desvio do fim do bloco é a troca de estado da máquina de controle: fica no último passo do bloco,
    // junto com as operações que terminam por último (por isso é tentado de novo depois das outras do passo).
    const isTerm = (n) => ['br', 'condbr', 'ret'].includes(n.inst.op);
    const lastStep = (n, t) => nodes.every((m) => m === n || (done.has(m.id) && m.start + m.lat <= t + 1));
    const place = (t, terms) => {
        const ready = nodes.filter((n) => !done.has(n.id) && isTerm(n) === terms && (!terms || lastStep(n, t))
            && n.preds.every((p) => done.has(p) && nodes[p].start + nodes[p].lat <= t))
            .sort((a, b) => a.alap - b.alap || a.id - b.id);
        for (const n of ready) {
            const u = UNIT_OF[n.cls];
            if (!u) { n.start = t; n.unit = null; done.add(n.id); continue; }
            const k = busy[u].findIndex((until) => until < t);
            if (k < 0) continue;
            busy[u][k] = pipelined ? t : t + Math.max(1, n.lat) - 1;
            n.start = t;
            n.unit = `${u}${k}`;
            done.add(n.id);
        }
    };
    for (let t = 0; done.size < nodes.length && t <= 100000; t++) {
        place(t, false);
        place(t, true);
    }
    const length = Math.max(0, ...nodes.map((n) => n.start + n.lat));
    const use = {};
    for (const u of UNITS) {
        const work = nodes.filter((n) => UNIT_OF[n.cls] === u).reduce((s, n) => s + (pipelined ? 1 : Math.max(1, n.lat)), 0);
        use[u] = length ? work / ((res[u] ?? 1) * length) : 0;
    }
    return { ...g, nodes, length, use, res, pipelined };
}

/** Escalonamento mais tarde possível (ALAP), com recursos ilimitados. */
export function alapSchedule(g) {
    return { ...g, nodes: g.nodes.map((n) => ({ ...n, start: n.alap })) };
}

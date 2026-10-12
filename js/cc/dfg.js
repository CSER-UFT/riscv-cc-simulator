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
export function blockDfg(F, label, lat = LATENCY) {
    const b = F.blocks.find((x) => x.label === label);
    const def = definitions(F);
    const { escaped, root } = escapedAllocas(F, def);
    const insts = b.insts.filter((i) => i.op !== 'alloca');
    const nodes = insts.map((inst, k) => {
        const cls = opClass(inst.op);
        return { id: k, inst, cls, lat: lat[cls] ?? 1, text: instText(inst), preds: [], succs: [] };
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
                if (!inputIdx.has(v)) { inputIdx.set(v, inputs.length); inputs.push({ value: v, text: valueText(v), to: [] }); }
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

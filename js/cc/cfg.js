/**
 * Análises do grafo de fluxo de controle (CFG) de uma função da IR, no estilo das análises do LLVM:
 * sucessores e predecessores, ordem pós-fixa reversa (RPO), dominadores pelo algoritmo iterativo de Cooper,
 * Harvey e Kennedy, árvore e fronteira de dominância, arestas de retorno e laços naturais com o
 * aninhamento de cada bloco.
 */

/** Sucessores de um bloco, com o tipo de cada aresta: 'T' e 'F' (desvio condicional) ou '' (incondicional). */
export function successors(b) {
    const term = b.insts[b.insts.length - 1];
    if (!term) return [];
    if (term.op === 'br') return [{ to: term.target, kind: '' }];
    if (term.op === 'condbr') return term.t === term.f ? [{ to: term.t, kind: '' }] : [{ to: term.t, kind: 'T' }, { to: term.f, kind: 'F' }];
    return [];
}

/**
 * @param {object} F função da IR
 * @returns {object} {blocks, index, succ, pred, edges, rpo, idom, children, doms, df, backEdges, loops, depth, loopOf}
 */
export function analyzeCfg(F) {
    const blocks = F.blocks.map((b) => b.label);
    const index = new Map(blocks.map((l, i) => [l, i]));
    const succ = new Map(F.blocks.map((b) => [b.label, successors(b)]));
    const pred = new Map(blocks.map((l) => [l, []]));
    const edges = [];
    for (const b of blocks) for (const s of succ.get(b)) { pred.get(s.to).push(b); edges.push({ from: b, to: s.to, kind: s.kind }); }

    // Ordem pós-fixa reversa a partir da entrada.
    const seen = new Set(), post = [];
    const dfs = (b) => {
        seen.add(b);
        for (const s of succ.get(b)) if (!seen.has(s.to)) dfs(s.to);
        post.push(b);
    };
    dfs(blocks[0]);
    const rpo = post.reverse();
    const rpoNum = new Map(rpo.map((b, i) => [b, i]));

    // Dominadores imediatos (Cooper, Harvey e Kennedy, "A Simple, Fast Dominance Algorithm").
    const idom = new Map([[rpo[0], rpo[0]]]);
    const intersect = (a, b) => {
        while (a !== b) {
            while (rpoNum.get(a) > rpoNum.get(b)) a = idom.get(a);
            while (rpoNum.get(b) > rpoNum.get(a)) b = idom.get(b);
        }
        return a;
    };
    let changed = true, iterations = 0;
    while (changed) {
        changed = false;
        iterations++;
        for (const b of rpo.slice(1)) {
            const ps = pred.get(b).filter((p) => idom.has(p));
            let d = ps[0];
            for (const p of ps.slice(1)) d = intersect(p, d);
            if (idom.get(b) !== d) { idom.set(b, d); changed = true; }
        }
    }
    const children = new Map(blocks.map((b) => [b, []]));
    for (const b of rpo.slice(1)) children.get(idom.get(b)).push(b);
    const doms = new Map();
    for (const b of rpo) {
        const list = [b];
        let x = b;
        while (x !== rpo[0]) { x = idom.get(x); list.push(x); }
        doms.set(b, list.reverse());
    }
    const dominates = (a, b) => doms.get(b)?.includes(a) ?? false;

    // Fronteira de dominância: para cada junção, sobe a partir de cada predecessor até o dominador imediato.
    const df = new Map(blocks.map((b) => [b, new Set()]));
    for (const b of rpo) {
        const ps = pred.get(b).filter((p) => rpoNum.has(p));
        if (ps.length < 2) continue;
        for (const p of ps) {
            let r = p;
            while (r !== idom.get(b)) { df.get(r).add(b); r = idom.get(r); }
        }
    }

    // Arestas de retorno (o destino domina a origem) e laços naturais.
    const backEdges = edges.filter((e) => dominates(e.to, e.from));
    const byHeader = new Map();
    for (const e of backEdges) {
        const body = byHeader.get(e.to)?.body ?? new Set([e.to]);
        const stack = [e.from];
        while (stack.length) {
            const x = stack.pop();
            if (body.has(x)) continue;
            body.add(x);
            for (const p of pred.get(x)) stack.push(p);
        }
        const loop = byHeader.get(e.to) ?? { header: e.to, body, latches: [] };
        loop.latches.push(e.from);
        byHeader.set(e.to, loop);
    }
    const loops = [...byHeader.values()].map((l) => ({ ...l, blocks: rpo.filter((b) => l.body.has(b)) }));
    loops.sort((a, b) => b.blocks.length - a.blocks.length);
    for (const l of loops) {
        const outer = loops.filter((o) => o !== l && o.body.has(l.header) && o.blocks.length > l.blocks.length);
        l.parent = outer.length ? outer[outer.length - 1].header : null;
        l.depth = outer.length + 1;
        l.exits = [...new Set(edges.filter((e) => l.body.has(e.from) && !l.body.has(e.to)).map((e) => e.to))];
    }
    const depth = new Map(blocks.map((b) => [b, loops.filter((l) => l.body.has(b)).length]));
    const loopOf = new Map();
    for (const b of blocks) {
        const inner = loops.filter((l) => l.body.has(b)).sort((x, y) => x.blocks.length - y.blocks.length)[0];
        if (inner) loopOf.set(b, inner.header);
    }
    return { blocks, index, succ, pred, edges, rpo, rpoNum, idom, children, doms, dominates, df, backEdges, loops, depth, loopOf, iterations };
}

/** Fronteira de dominância iterada de um conjunto de blocos (onde a mem2reg coloca as phi). */
export function iteratedDF(cfg, defs) {
    const out = new Set();
    const work = [...defs];
    while (work.length) {
        const b = work.pop();
        for (const d of cfg.df.get(b) ?? []) {
            if (!out.has(d)) { out.add(d); work.push(d); }
        }
    }
    return out;
}

/**
 * Figura do grafo de fluxo de dados de um bloco, em escala de tempo: a posição vertical de cada instrução é o
 * ciclo em que ela pode começar no escalonamento mais cedo (ASAP) e a altura é a sua latência. Instruções que
 * se sobrepõem no tempo ficam em colunas diferentes. O caminho crítico fica destacado.
 */
import { esc } from './highlight.js';
import { valueText } from '../cc/irgen.js';

const ROW = 30, CH = 6.7, PAD = 14, AXIS = 44, INPUTS = 46, GAP = 18;

/** Texto curto de uma instrução, para caber no nó. */
export function shortText(i) {
    const V = valueText;
    const d = i.dst ? `${V(i.dst)} = ` : '';
    switch (i.op) {
        case 'load': return `${d}load ${V(i.ptr)}`;
        case 'store': return `store → ${V(i.ptr)}`;
        case 'gep': return `${d}gep`;
        case 'icmp': case 'fcmp': return `${d}${i.op} ${i.cond}`;
        case 'call': return `${d}call @${i.fn}`;
        case 'condbr': return `br ${V(i.cond)}`;
        case 'br': return 'br';
        case 'ret': return i.val ? `ret ${V(i.val)}` : 'ret';
        default: return `${d}${i.op}`;
    }
}

export function layoutDfg(g, summaryLen = 90) {
    const nodes = g.nodes.map((n) => ({ n, label: shortText(n.inst), y0: n.start, y1: n.start + Math.max(n.lat, 0.5) }));
    // Colunas: cada instrução vai para a primeira coluna livre no seu intervalo de tempo.
    const cols = [];
    for (const it of [...nodes].sort((a, b) => a.y0 - b.y0 || a.n.id - b.n.id)) {
        // De preferência na coluna de um predecessor (o do caminho crítico primeiro), para as cadeias ficarem retas.
        const preds = [...it.n.preds].sort((a, b) => Number(g.nodes[b].critical) - Number(g.nodes[a].critical));
        let c = preds.map((p) => nodes[p].col).find((pc) => cols[pc] <= it.y0 + 1e-9) ?? -1;
        if (c < 0) c = cols.findIndex((end) => end <= it.y0 + 1e-9);
        if (c < 0) { c = cols.length; cols.push(0); }
        cols[c] = it.y1;
        it.col = c;
    }
    const colW = cols.map((_, c) => Math.max(90, ...nodes.filter((it) => it.col === c).map((it) => it.label.length * CH + 16)));
    const colX = [];
    let x = PAD + AXIS;
    colW.forEach((w) => { colX.push(x + w / 2); x += w + GAP; });
    for (const it of nodes) {
        it.x = colX[it.col];
        it.w = colW[it.col];
        it.top = PAD + INPUTS + it.y0 * ROW;
        it.h = Math.max(14, (it.y1 - it.y0) * ROW - 4);
    }
    const inputs = g.inputs.map((inp) => {
        const xs = inp.to.map((k) => nodes[k].x);
        return { ...inp, x: xs.reduce((s, v) => s + v, 0) / xs.length, w: Math.max(40, inp.text.length * CH + 14) };
    });
    // Entradas que caem no mesmo lugar são afastadas.
    inputs.sort((a, b) => a.x - b.x);
    let right = PAD + AXIS - GAP;
    for (const inp of inputs) { inp.x = Math.max(inp.x, right + 8 + inp.w / 2); right = inp.x + inp.w / 2; }
    const width = Math.ceil(Math.max(x - GAP, right, PAD + AXIS + summaryLen * 6.4) + PAD);
    const height = Math.ceil(PAD + INPUTS + Math.max(1, g.length) * ROW + 34);
    return { nodes, inputs, width, height };
}

/**
 * @param {object} g saída de blockDfg
 * @param {object} lay saída de layoutDfg
 * @param {{selected?: number|null, tr: Function}} opts
 */
export function dfgSvg(g, lay, { selected = null, tr, summary = null }) {
    const { nodes, inputs, width, height } = lay;
    const near = new Set();
    if (selected !== null) {
        near.add(selected);
        for (const e of g.edges) { if (e.from === selected) near.add(e.to); if (e.to === selected) near.add(e.from); }
    }
    const top0 = PAD + INPUTS;
    let s = `<svg class="fig-svg dfg" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`;
    // Eixo do tempo.
    s += `<text class="small muted" x="${PAD}" y="${top0 - 8}">${esc(tr('dfg.cycle'))}</text>`;
    for (let c = 0; c <= g.length; c++) {
        const y = top0 + c * ROW;
        s += `<line class="grid" x1="${PAD + AXIS - 6}" y1="${y}" x2="${width - PAD}" y2="${y}"/>`;
        s += `<text class="small muted mono" x="${PAD + AXIS - 10}" y="${y + 4}" text-anchor="end">${c}</text>`;
    }
    const arrow = (x, y, cls) => `<polygon class="${cls}" points="${x - 4},${y - 7} ${x + 4},${y - 7} ${x},${y}"/>`;
    // Entradas vindas de fora do bloco.
    for (const inp of inputs) {
        for (const k of inp.to) {
            const t = nodes[k];
            s += `<path class="wire input" d="M${inp.x},${PAD + 30} C${inp.x},${t.top - 10} ${t.x},${PAD + 30} ${t.x},${t.top - 7}"/>`;
            s += arrow(t.x, t.top, 'head');
        }
    }
    for (const inp of inputs) {
        s += `<ellipse class="inp" cx="${inp.x}" cy="${PAD + 18}" rx="${inp.w / 2}" ry="12"/>`;
        s += `<text class="mono small" x="${inp.x}" y="${PAD + 22}" text-anchor="middle">${esc(inp.text)}</text>`;
    }
    // Arestas entre instruções.
    for (const e of g.edges) {
        const a = nodes[e.from], b = nodes[e.to];
        const sy = a.top + a.h, ty = b.top;
        const my = sy + Math.max(10, (ty - sy) / 2);
        const cls = ['wire', e.kind === 'mem' ? 'mem' : '', e.critical ? 'crit' : '', selected !== null && (e.from === selected || e.to === selected) ? 'on' : ''].filter(Boolean).join(' ');
        s += `<path class="${cls}" d="M${a.x},${sy} C${a.x},${my} ${b.x},${Math.min(my, ty - 10)} ${b.x},${ty - 7}"/>`;
        s += arrow(b.x, ty, `head${e.critical ? ' crit' : ''}`);
    }
    for (const it of nodes) {
        const n = it.n;
        const cls = ['op', `c-${n.cls}`, n.critical ? 'crit' : '', n.id === selected ? 'sel' : '', selected !== null && !near.has(n.id) ? 'dim' : ''].filter(Boolean).join(' ');
        s += `<g class="node" data-id="${n.id}"><title>${esc(n.text)}</title><rect class="${cls}" x="${it.x - it.w / 2}" y="${it.top}" width="${it.w}" height="${it.h}" rx="5"/>`;
        s += `<text class="mono small${n.critical ? ' bold' : ''}" x="${it.x}" y="${it.top + Math.min(it.h / 2 + 4, 15)}" text-anchor="middle">${esc(it.label)}</text>`;
        if (it.h >= 30) s += `<text class="small muted" x="${it.x}" y="${it.top + 28}" text-anchor="middle">${esc(n.unit ? `${n.unit} · ${tr('dfg.lat', { n: n.lat })}` : tr('dfg.lat', { n: n.lat }))}</text>`;
        else if (n.unit) s += `<title>${esc(n.unit)}</title>`;
        s += '</g>';
    }
    s += `<text class="small bold" x="${PAD + AXIS}" y="${height - 12}">${esc(summary ?? tr('dfg.summary', { len: g.length, sum: g.seqSum, ilp: g.length ? (g.seqSum / g.length).toFixed(2) : '-' }))}</text>`;
    return `${s}</svg>`;
}

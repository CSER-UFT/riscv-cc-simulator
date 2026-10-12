/**
 * Figuras do grafo de fluxo de controle e da árvore de dominadores.
 *
 * O CFG é desenhado em camadas, de cima para baixo: cada bloco fica abaixo de todos os seus predecessores
 * pelas arestas de avanço, e a saída de um laço fica abaixo de todo o laço. As arestas de retorno (do fim do
 * laço para o cabeçalho) sobem pela direita. A cor de fundo mostra a profundidade de aninhamento dos laços.
 */
import { esc } from './highlight.js';
import { instText } from '../cc/irgen.js';

const CH = 6.7, LINE = 15, HEAD = 24, GAP_Y = 46, GAP_X = 34, PAD = 16;

const arrow = (x, y, dir, cls) => {
    const p = { down: [[x - 5, y - 9], [x + 5, y - 9], [x, y]], left: [[x + 9, y - 5], [x + 9, y + 5], [x, y]], right: [[x - 9, y - 5], [x - 9, y + 5], [x, y]] }[dir];
    return `<polygon class="${cls}" points="${p.map((q) => q.join(',')).join(' ')}"/>`;
};

/** Posição de cada bloco no desenho. */
export function layoutCfg(F, cfg, showInsts, tr, extra = null) {
    const back = new Set(cfg.backEdges.map((e) => `${e.from}>${e.to}`));
    const fwdPreds = (b) => cfg.pred.get(b).filter((p) => !back.has(`${p}>${b}`));
    const layer = new Map();
    const relayer = () => {
        for (const b of cfg.rpo) layer.set(b, Math.max(layer.get(b) ?? 0, 0, ...fwdPreds(b).map((p) => (layer.get(p) ?? 0) + 1)));
    };
    relayer();
    // A saída de cada laço vai para baixo de todo o laço.
    for (let k = 0; k < 4; k++) {
        for (const l of [...cfg.loops].reverse()) {
            const bottom = Math.max(...l.blocks.map((b) => layer.get(b)));
            for (const e of l.exits) layer.set(e, Math.max(layer.get(e), bottom + 1));
        }
        relayer();
    }
    const blocks = F.blocks.filter((b) => layer.has(b.label));
    const boxes = new Map();
    for (const b of blocks) {
        const lines = showInsts ? b.insts.map((i) => `  ${instText(i)}`) : [];
        const tags = [];
        if (b.label === cfg.rpo[0]) tags.push(tr('cfg.entry'));
        if (cfg.loops.some((l) => l.header === b.label)) tags.push(tr('cfg.header'));
        if (!cfg.succ.get(b.label).length) tags.push(tr('cfg.exit'));
        const tagText = tags.join(', ');
        const side = Math.max(tagText.length, extra?.get(b.label)?.length ?? 0);
        const w = Math.max((b.label.length + 1) * CH + (side ? side * 6.2 + 16 : 0) + 18, ...lines.map((l) => l.length * CH + 18));
        boxes.set(b.label, { label: b.label, lines, tagText, w: Math.max(80, w), h: HEAD + lines.length * LINE + (lines.length ? 6 : 0), layer: layer.get(b.label) });
    }
    const nLayers = Math.max(...[...layer.values()]) + 1;
    const rows = Array.from({ length: nLayers }, () => []);
    for (const b of cfg.rpo) rows[layer.get(b)].push(boxes.get(b));
    let y = PAD;
    for (const row of rows) {
        // Ordem e posição pela média dos predecessores já posicionados (baricentro).
        for (const bx of row) {
            const ps = fwdPreds(bx.label).map((p) => boxes.get(p)).filter((p) => p.x !== undefined);
            bx.want = ps.length ? ps.reduce((s, p) => s + p.x, 0) / ps.length : 0;
            // Empate: o destino do V (T) à esquerda do F, como as saídas do bloco.
            const p0 = fwdPreds(bx.label)[0];
            bx.ord = p0 ? cfg.succ.get(p0).findIndex((x) => x.to === bx.label) : 0;
        }
        row.sort((a, b) => a.want - b.want || a.ord - b.ord);
        let right = -Infinity;
        for (const bx of row) {
            bx.x = Math.max(bx.want, right + GAP_X + bx.w / 2);
            right = bx.x + bx.w / 2;
        }
        const shift = row.reduce((s, b) => s + b.want - b.x, 0) / row.length;
        for (const bx of row) bx.x += shift;
        const h = Math.max(...row.map((b) => b.h));
        for (const bx of row) bx.y = y;
        y += h + GAP_Y;
    }
    // Arestas de avanço que pulam camadas descem por uma pista à esquerda, para não cruzar os blocos.
    const longEdges = cfg.edges.filter((e) => !back.has(`${e.from}>${e.to}`) && boxes.get(e.to).layer - boxes.get(e.from).layer > 1)
        .map((e, k) => ({ ...e, k }));
    const lanes = longEdges.length ? longEdges.length * 14 + 16 : 0;
    const minX = Math.min(...[...boxes.values()].map((b) => b.x - b.w / 2));
    for (const bx of boxes.values()) bx.x += PAD + lanes - minX;
    let width = Math.max(...[...boxes.values()].map((b) => b.x + b.w / 2)) + PAD;
    const backRoutes = cfg.backEdges.map((e, k) => ({ ...e, k }));
    width += backRoutes.length * 14 + (backRoutes.length ? 16 : 0);
    return { boxes, width, height: y - GAP_Y + PAD + 6, back, backRoutes, longEdges, lanes };
}

/**
 * @param {object} layout saída de layoutCfg
 * @param {object} cfg saída de analyzeCfg
 * @param {{selected?: string|null, tr: Function}} opts
 */
export function cfgSvg(layout, cfg, { selected = null, tr, heat = null }) {
    const { boxes, width, height, back, backRoutes, longEdges } = layout;
    const isLong = new Set(longEdges.map((e) => `${e.from}>${e.to}`));
    const minLeft = Math.min(...[...boxes.values()].map((b) => b.x - b.w / 2));
    const doms = selected ? new Set(cfg.doms.get(selected)) : new Set();
    const df = selected ? cfg.df.get(selected) : new Set();
    let s = `<svg class="fig-svg cfg" xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="${Math.ceil(height)}" viewBox="0 0 ${Math.ceil(width)} ${Math.ceil(height)}" role="img">`;
    // Arestas de avanço.
    for (const e of cfg.edges) {
        if (back.has(`${e.from}>${e.to}`) || isLong.has(`${e.from}>${e.to}`)) continue;
        const a = boxes.get(e.from), b = boxes.get(e.to);
        const nOut = cfg.succ.get(e.from).length;
        const sx = nOut === 2 ? a.x + (e.kind === 'T' ? -a.w / 4 : a.w / 4) : a.x;
        const sy = a.y + a.h, tx = b.x, ty = b.y;
        const my = (sy + ty) / 2;
        const on = selected && (e.from === selected || e.to === selected);
        s += `<path class="wire${on ? ' on' : ''}" d="M${sx},${sy} C${sx},${my} ${tx},${my} ${tx},${ty - 8}"/>`;
        s += arrow(tx, ty, 'down', `head${on ? ' on' : ''}`);
        if (e.kind) s += `<text class="small bold ${e.kind === 'T' ? 'tlabel' : 'flabel'}" x="${sx + (e.kind === 'T' ? -10 : 5)}" y="${sy + 13}">${tr(`cfg.${e.kind}`)}</text>`;
    }
    // Arestas longas, pela esquerda.
    for (const e of longEdges) {
        const a = boxes.get(e.from), b = boxes.get(e.to);
        const xl = minLeft - 16 - e.k * 14;
        const sy = a.y + Math.min(a.h / 2, 14), ty = b.y + 12;
        const on = selected && (e.from === selected || e.to === selected);
        s += `<path class="wire${on ? ' on' : ''}" d="M${a.x - a.w / 2},${sy} H${xl} V${ty} H${b.x - b.w / 2 - 9}"/>`;
        s += arrow(b.x - b.w / 2, ty, 'right', `head${on ? ' on' : ''}`);
        if (e.kind) s += `<text class="small bold ${e.kind === 'T' ? 'tlabel' : 'flabel'}" x="${a.x - a.w / 2 - 12}" y="${sy - 4}">${tr(`cfg.${e.kind}`)}</text>`;
    }
    // Arestas de retorno, pela direita.
    const maxRight = Math.max(...[...boxes.values()].map((b) => b.x + b.w / 2));
    for (const e of backRoutes) {
        const a = boxes.get(e.from), b = boxes.get(e.to);
        const xr = maxRight + 16 + e.k * 14;
        const sy = a.y + Math.min(a.h / 2, 14), ty = b.y + 12;
        const on = selected && (e.from === selected || e.to === selected);
        s += `<path class="wire back${on ? ' on' : ''}" d="M${a.x + a.w / 2},${sy} H${xr} V${ty} H${b.x + b.w / 2 + 9}"/>`;
        s += arrow(b.x + b.w / 2, ty, 'left', `head back${on ? ' on' : ''}`);
    }
    for (const bx of boxes.values()) {
        const d = cfg.depth.get(bx.label);
        const cls = ['blk', `depth${Math.min(d, 3)}`, bx.label === selected ? 'sel' : '', doms.has(bx.label) && bx.label !== selected ? 'dom' : '', df.has(bx.label) ? 'df' : ''].filter(Boolean).join(' ');
        const x0 = bx.x - bx.w / 2;
        // No mapa de calor, a cor do bloco vem da intensidade (0 a 1) e o valor substitui as etiquetas.
        const h = heat?.get(bx.label);
        const style = h ? ` style="fill: color-mix(in srgb, var(--heat) ${Math.round(6 + 80 * h.i)}%, var(--panel))"` : '';
        s += `<g class="node" data-block="${esc(bx.label)}"><rect class="${cls}${h ? ' heat' : ''}" x="${x0}" y="${bx.y}" width="${bx.w}" height="${bx.h}" rx="5"${style}/>`;
        s += `<text class="mono bold" x="${x0 + 8}" y="${bx.y + 16}">${esc(bx.label)}:</text>`;
        if (h) s += `<text class="small bold" x="${x0 + bx.w - 8}" y="${bx.y + 16}" text-anchor="end">${esc(h.text)}</text>`;
        else if (bx.tagText) s += `<text class="small muted" x="${x0 + bx.w - 8}" y="${bx.y + 16}" text-anchor="end">${esc(bx.tagText)}</text>`;
        bx.lines.forEach((l, k) => { s += `<text class="mono small" x="${x0 + 8}" y="${bx.y + HEAD + 10 + k * LINE}" xml:space="preserve">${esc(l)}</text>`; });
        s += '</g>';
    }
    return `${s}</svg>`;
}

/** Árvore de dominadores: cada bloco fica abaixo do seu dominador imediato. */
export function domTreeSvg(cfg, { selected = null }) {
    const W = (l) => Math.max(60, (l.length + 1) * 7.2 + 16), H = 26, VG = 34, HG = 12;
    const pos = new Map();
    let nextX = PAD, maxDepth = 0;
    const place = (b, depth) => {
        maxDepth = Math.max(maxDepth, depth);
        const kids = cfg.children.get(b);
        const w = W(b);
        if (!kids.length) { pos.set(b, { x: nextX + w / 2, depth, w }); nextX += w + HG; return; }
        const start = nextX;
        kids.forEach((k) => place(k, depth + 1));
        let mid = (pos.get(kids[0]).x + pos.get(kids[kids.length - 1]).x) / 2;
        if (mid - w / 2 < start) {
            const dx = start - (mid - w / 2);
            const shift = (x) => { pos.get(x).x += dx; cfg.children.get(x).forEach(shift); };
            kids.forEach(shift);
            mid += dx;
            nextX += dx;
        }
        pos.set(b, { x: mid, depth, w });
        nextX = Math.max(nextX, mid + w / 2 + HG);
    };
    place(cfg.rpo[0], 0);
    const width = Math.ceil(nextX - HG + PAD), height = PAD * 2 + (maxDepth + 1) * H + maxDepth * VG;
    const y = (d) => PAD + d * (H + VG);
    const doms = selected ? new Set(cfg.doms.get(selected)) : new Set();
    const df = selected ? cfg.df.get(selected) : new Set();
    let s = `<svg class="fig-svg domtree" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`;
    for (const [b, p] of pos) {
        for (const c of cfg.children.get(b)) {
            const q = pos.get(c);
            const on = doms.has(c) && doms.has(b);
            s += `<line class="wire${on ? ' on' : ''}" x1="${p.x}" y1="${y(p.depth) + H}" x2="${q.x}" y2="${y(q.depth)}"/>`;
        }
    }
    for (const [b, p] of pos) {
        const cls = ['blk', `depth${Math.min(cfg.depth.get(b), 3)}`, b === selected ? 'sel' : '', doms.has(b) && b !== selected ? 'dom' : '', df.has(b) ? 'df' : ''].filter(Boolean).join(' ');
        s += `<g class="node" data-block="${esc(b)}"><rect class="${cls}" x="${p.x - p.w / 2}" y="${y(p.depth)}" width="${p.w}" height="${H}" rx="5"/>`;
        s += `<text class="mono bold" x="${p.x}" y="${y(p.depth) + 17}" text-anchor="middle">${esc(b)}</text></g>`;
    }
    return `${s}</svg>`;
}

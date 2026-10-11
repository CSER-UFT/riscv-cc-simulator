/**
 * Figura do registro de ativação (quadro da pilha) de uma função: os endereços crescem para cima; s0 aponta
 * para o topo do quadro (o sp de quem chamou) e sp para a base. Cada posição mostra o deslocamento em
 * relação a s0, usado no código gerado, e em relação a sp.
 */
import { esc } from './highlight.js';

const ROW = 24, X0 = 118, BW = 190, TOP = 46;

/**
 * @param {{fn: string, size: number, slots: Array}} frame
 * @param {Function} tr tradução
 * @param {string|null} selected nome da posição em destaque
 */
export function frameSvg(frame, tr, selected = null) {
    const slots = [...frame.slots].sort((a, b) => b.off - a.off);
    const rows = [];
    let y = TOP + ROW;   // abaixo da faixa do quadro de quem chamou
    for (const s of slots) {
        const h = s.kind === 'array' ? ROW * Math.min(3, s.size / 4) : ROW;
        rows.push({ ...s, y, h });
        y += h;
    }
    const used = -Math.min(-8, ...slots.map((s) => s.off));
    const pad = frame.size - used;
    if (pad > 0) { rows.push({ kind: 'pad', name: '', off: -frame.size, size: pad, y, h: ROW }); y += ROW; }
    const height = y + 40;
    const width = 560;
    let s = `<svg class="fig-svg frame" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`;
    s += `<text class="title" x="${X0}" y="18">${esc(tr('frame.title', { fn: frame.fn, n: frame.size }))}</text>`;
    // Quadro de quem chamou.
    s += `<rect class="caller" x="${X0}" y="${TOP}" width="${BW}" height="${ROW}"/>`;
    s += `<text class="small muted" x="${X0 + BW / 2}" y="${TOP + 16}" text-anchor="middle">${esc(tr('frame.caller'))}</text>`;
    s += `<text class="small muted" x="${X0 + BW + 12}" y="${TOP + 4}">${esc(tr('frame.higher'))} ↑</text>`;
    for (const r of rows) {
        const cls = `slot k-${r.kind}${selected && r.name === selected ? ' sel' : ''}`;
        s += `<rect class="${cls}" x="${X0}" y="${r.y}" width="${BW}" height="${r.h}"/>`;
        const label = r.kind === 'array' ? `${r.name}[0..${r.size / 4 - 1}]` : r.kind === 'pad' ? '' : r.name;
        s += `<text class="mono" x="${X0 + BW / 2}" y="${r.y + r.h / 2 + 4}" text-anchor="middle">${esc(label)}</text>`;
        if (r.kind !== 'pad') {
            s += `<text class="mono small" x="${X0 - 8}" y="${r.y + r.h - 7}" text-anchor="end">${r.off}(s0)</text>`;
            s += `<text class="mono small muted" x="${X0 + BW + 12}" y="${r.y + r.h - 7}">${r.off + frame.size}(sp)</text>`;
        }
        s += `<text class="small" x="${X0 + BW + 80}" y="${r.y + r.h - 7}">${esc(tr(`frame.k.${r.kind}`, { name: r.name, n: r.size, ty: r.ty ?? '' }))}</text>`;
    }
    // Ponteiros s0 e sp.
    const yTop = TOP + ROW, yBot = y;
    s += `<line class="ptr" x1="44" y1="${yTop}" x2="${X0 - 2}" y2="${yTop}"/><text class="mono bold" x="8" y="${yTop + 4}">s0 →</text>`;
    s += `<line class="ptr" x1="44" y1="${yBot}" x2="${X0 - 2}" y2="${yBot}"/><text class="mono bold" x="8" y="${yBot + 4}">sp →</text>`;
    s += `<text class="small muted" x="${X0}" y="${yBot + 22}">${esc(tr('frame.note'))}</text>`;
    return `${s}</svg>`;
}

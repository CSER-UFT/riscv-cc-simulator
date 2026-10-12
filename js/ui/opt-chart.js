/**
 * Gráfico de erro contra ganho de uma técnica aproximada: um ponto por valor do parâmetro, ligados em ordem.
 * Na perfuração de laço o eixo horizontal é a aceleração em ciclos; na redução de precisão e na multiplicação
 * aproximada, que em software são emuladas com instruções a mais, é o número de bits.
 */
import { esc } from './highlight.js';

const W = 640, H = 340, L = 64, R = 24, TOP = 24, B = 52;

function ticks(lo, hi, n = 5) {
    const span = hi - lo || 1;
    const step0 = span / n;
    const mag = 10 ** Math.floor(Math.log10(step0));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? mag * 10;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
}

/**
 * @param {Array<{x, mre, speedup, finished}>} pts
 * @param {{xKey: 'speedup'|'x', xLabel: string, yLabel: string, pLabel: (p) => string, title: string}} o
 */
export function optChartSvg(pts, o) {
    const ok = pts.filter((p) => p.finished && Number.isFinite(p.mre) && p[o.xKey] !== null);
    const xs = ok.map((p) => p[o.xKey]), ys = ok.map((p) => 100 * p.mre);
    const x0 = Math.min(...xs, o.xKey === 'speedup' ? 1 : Infinity), x1 = Math.max(...xs);
    const y1 = Math.max(1, ...ys) * 1.08;
    const xr = x1 - x0 || 1;
    const sx = (v) => L + ((v - x0) / xr) * (W - L - R);
    const sy = (v) => H - B - (v / y1) * (H - B - TOP);
    let s = `<svg class="fig-svg chart" xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">`;
    s += `<text class="title" x="${L}" y="16">${esc(o.title)}</text>`;
    for (const v of ticks(0, y1)) {
        s += `<line class="grid" x1="${L}" y1="${sy(v)}" x2="${W - R}" y2="${sy(v)}"/><text class="small muted" x="${L - 8}" y="${sy(v) + 4}" text-anchor="end">${v}</text>`;
    }
    for (const v of ticks(x0, x1)) {
        s += `<line class="grid" x1="${sx(v)}" y1="${TOP}" x2="${sx(v)}" y2="${H - B}"/><text class="small muted" x="${sx(v)}" y="${H - B + 16}" text-anchor="middle">${v}</text>`;
    }
    s += `<line class="axis" x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}"/><line class="axis" x1="${L}" y1="${TOP}" x2="${L}" y2="${H - B}"/>`;
    s += `<text class="small" x="${(L + W - R) / 2}" y="${H - 14}" text-anchor="middle">${esc(o.xLabel)}</text>`;
    s += `<text class="small" transform="translate(16 ${(TOP + H - B) / 2}) rotate(-90)" text-anchor="middle">${esc(o.yLabel)}</text>`;
    const sorted = [...ok].sort((a, b) => a[o.xKey] - b[o.xKey]);
    if (sorted.length > 1) s += `<polyline class="series" points="${sorted.map((p) => `${sx(p[o.xKey])},${sy(100 * p.mre)}`).join(' ')}"/>`;
    for (const p of ok) {
        const cx = sx(p[o.xKey]), cy = sy(100 * p.mre);
        s += `<circle class="pt" cx="${cx}" cy="${cy}" r="4.5"><title>${esc(o.pLabel(p))}</title></circle>`;
        s += `<text class="small bold" x="${cx + 7}" y="${cy - 7}">${esc(o.pLabel(p))}</text>`;
    }
    return `${s}</svg>`;
}

/**
 * Exportação das figuras (sistema e diagrama de estados) do passo atual como um arquivo SVG
 * independente. O estilo calculado pelo navegador (com o tema claro, mesmo que a página esteja no escuro)
 * é gravado em cada elemento como atributos de apresentação (fill, stroke, font-size...), sem folha de
 * estilo nem variáveis CSS, para que o desenho abra igual no navegador, no Inkscape, no LibreOffice e no
 * PowerPoint.
 */

const PROPS = {
    rect: ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity'],
    path: ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity'],
    polyline: ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity'],
    polygon: ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity'],
    circle: ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity'],
    ellipse: ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity'],
    line: ['stroke', 'stroke-width', 'stroke-dasharray', 'opacity'],
    text: ['fill', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'opacity'],
    tspan: ['fill', 'font-family', 'font-size', 'font-weight', 'font-style', 'opacity'],
};

/** Cor calculada (rgb, rgba ou color(srgb ...)) em hexadecimal; mantém none e transparent. */
export function toHex(value) {
    const v = value.trim();
    if (!v || v === 'none') return 'none';
    let m = v.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
    let rgb, alpha = 1;
    if (m) {
        rgb = [m[1], m[2], m[3]].map(Number);
        if (m[4] !== undefined) alpha = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : Number(m[4]);
    } else {
        m = v.match(/^color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/);
        if (!m) return v;
        rgb = [m[1], m[2], m[3]].map((x) => Number(x) * 255);
        if (m[4] !== undefined) alpha = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : Number(m[4]);
    }
    if (alpha === 0) return 'none';
    return `#${rgb.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')}`;
}

function copyStyles(src, dst) {
    const tag = src.tagName.toLowerCase();
    const props = PROPS[tag];
    if (props) {
        const cs = getComputedStyle(src);
        for (const p of props) {
            let v = cs.getPropertyValue(p);
            if (!v) continue;
            if (p === 'fill' || p === 'stroke') v = toHex(v);
            if (p === 'stroke-dasharray' && v === 'none') continue;
            if (p === 'opacity' && v === '1') continue;
            if (p === 'font-weight' && (v === '400' || v === 'normal')) continue;
            if (p === 'font-style' && v === 'normal') continue;
            if (p === 'text-anchor' && v === 'start') continue;
            if (p === 'dominant-baseline' && v === 'auto') continue;
            dst.setAttribute(p, v);
        }
        dst.removeAttribute('style');
    }
    dst.removeAttribute('class');
    for (let i = 0; i < src.children.length; i++) copyStyles(src.children[i], dst.children[i]);
}

/**
 * Arquivo SVG independente a partir do diagrama mostrado.
 * @param {SVGSVGElement} svg o elemento na página
 */
export function standaloneSvg(svg) {
    const root = document.documentElement;
    const prev = root.dataset.theme;
    const clone = svg.cloneNode(true);
    // O estilo é lido com o tema claro; como tudo acontece na mesma tarefa, a página não chega a piscar.
    root.dataset.theme = 'light';
    try {
        copyStyles(svg, clone);
    } finally {
        if (prev === undefined) delete root.dataset.theme;
        else root.dataset.theme = prev;
    }
    clone.removeAttribute('class');
    clone.removeAttribute('role');
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    // Margem em volta, para que os contornos da borda não sejam cortados.
    const M = 10;
    const vb = (svg.getAttribute('viewBox') ?? `0 0 ${svg.getAttribute('width')} ${svg.getAttribute('height')}`).split(/[\s,]+/).map(Number);
    const [x0, y0] = [vb[0] - M, vb[1] - M];
    const w = vb[2] + 2 * M, h = vb[3] + 2 * M;
    clone.setAttribute('width', w);
    clone.setAttribute('height', h);
    clone.setAttribute('viewBox', `${x0} ${y0} ${w} ${h}`);
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    for (const [k, v] of Object.entries({ x: x0, y: y0, width: w, height: h, fill: '#ffffff' })) bg.setAttribute(k, v);
    clone.insertBefore(bg, clone.firstChild);
    return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}\n`;
}

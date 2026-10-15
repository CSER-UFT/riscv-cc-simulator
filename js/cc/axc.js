/**
 * Multiplicador aproximado vindo do Simulador de Computação Aproximada (axc-simulator).
 *
 * O axc abre este simulador com #axc=<perfil> no endereço: a configuração da unidade, o custo dela e o da unidade
 * exata de mesma largura (portas e profundidade do modelo de portas; área em µm² e atraso em ps da síntese com a
 * biblioteca sky130, quando a configuração foi sintetizada) e as métricas de erro. Aqui o perfil muda a latência
 * da multiplicação no grafo de fluxo de dados e no escalonamento, e dá a área dos multiplicadores alocados.
 * O resultado do programa não muda: a execução continua exata.
 */

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Lê e valida um perfil (objeto já decodificado). Devolve null se faltar o essencial.
 * @returns {null | {name: string, width: number, gates: number, gatesExact: number, depth: number, depthExact: number,
 *   area: number|null, areaExact: number|null, delay: number|null, delayExact: number|null, MRED: number|null, NMED: number|null, EP: number|null}}
 */
export function parseProfile(p) {
    if (!p || typeof p !== 'object' || typeof p.name !== 'string') return null;
    const gates = num(p.gates), gatesExact = num(p.gatesExact), depth = num(p.depth), depthExact = num(p.depthExact);
    if (!(gates > 0 && gatesExact > 0 && depth > 0 && depthExact > 0)) return null;
    const asic = p.asic && typeof p.asic === 'object' ? p.asic : {};
    return {
        name: p.name.slice(0, 60),
        width: num(p.width) ?? 8,
        gates, gatesExact, depth, depthExact,
        area: num(asic.area), areaExact: num(asic.areaExact), delay: num(asic.delay), delayExact: num(asic.delayExact),
        MRED: num(p.MRED), NMED: num(p.NMED), EP: num(p.EP),
    };
}

/** Razão de atraso da unidade aproximada sobre a exata: pela síntese ASIC, se houver, senão pela profundidade. */
export function delayRatio(prof) {
    if (prof.delay && prof.delayExact) return { ratio: prof.delay / prof.delayExact, source: 'asic' };
    return { ratio: prof.depth / prof.depthExact, source: 'gates' };
}

/** Latência da multiplicação aproximada: a da exata escalada pela razão de atraso, arredondada para cima. */
export function approxLatency(baseLatency, prof) {
    return Math.max(1, Math.ceil(baseLatency * delayRatio(prof).ratio - 1e-9));
}

/** Área de um multiplicador (aproximado e exato): µm² da síntese, se houver, senão portas. */
export function unitArea(prof) {
    if (prof.area && prof.areaExact) return { approx: prof.area, exact: prof.areaExact, unit: 'µm²' };
    return { approx: prof.gates, exact: prof.gatesExact, unit: 'gates' };
}

/** Quantos multiplicadores aproximados cabem na área de n exatos. */
export function sameAreaCount(n, prof) {
    const a = unitArea(prof);
    return Math.max(1, Math.floor((n * a.exact) / a.approx + 1e-9));
}

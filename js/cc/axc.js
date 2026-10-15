/**
 * Multiplicador e somador aproximados vindos do Simulador de Computação Aproximada (axc-simulator).
 *
 * Cada unidade é um perfil: a configuração, o custo dela e o da unidade exata de mesma largura (portas e
 * profundidade do modelo de portas; área em µm² e atraso em ps da síntese com a biblioteca sky130, quando a
 * configuração foi sintetizada) e as métricas de erro. Os perfis vêm de dois lugares: o botão do axc, que abre
 * este simulador com #axc=<perfil> no endereço (qualquer configuração), e a lista de configurações sintetizadas
 * do axc (data/synth.json), lida do mesmo site. Aqui o perfil muda a latência da multiplicação (multiplicador)
 * ou da soma e da subtração (somador) no grafo de fluxo de dados e no escalonamento, e dá a área das unidades
 * alocadas. O resultado do programa não muda: a execução continua exata.
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
    const kind = p.kind === 'add' || p.cfg?.kind === 'add' ? 'add' : 'mul';
    return {
        kind,
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

/** Nome da unidade exata de referência de uma configuração (o Booth compara com o Booth exato). */
function exactName(cfg) {
    const N = cfg.width;
    if (cfg.kind === 'add') return `ADD${N} exato`;
    return cfg.method === 'booth' ? `MUL${N} BOOTH` : `MUL${N} exato`;
}

/**
 * Perfis das configurações sintetizadas do axc (data/synth.json), sem as exatas.
 * @returns {Array<object>} perfis prontos para parseProfile
 */
export function profilesFromSynth(synth) {
    const byName = new Map((synth?.designs ?? []).map((d) => [d.name, d]));
    const out = [];
    for (const d of synth?.designs ?? []) {
        const ref = byName.get(exactName(d.cfg));
        if (!ref || ref === d || / exato$/.test(d.name)) continue;
        if (d.cfg.kind === 'mul' && d.cfg.method === 'booth' && !d.cfg.kTrunc && !d.cfg.comp) continue;
        const p = {
            kind: d.cfg.kind, name: d.name, cfg: d.cfg, width: d.cfg.width,
            gates: d.gates, gatesExact: ref.gates, depth: d.gateDepth, depthExact: ref.gateDepth,
            MRED: d.err?.MRED ?? null, NMED: d.err?.NMED ?? null, EP: d.err?.EP ?? null,
        };
        if (d.asic && ref.asic) p.asic = { area: d.asic.area, areaExact: ref.asic.area, delay: d.asic.delay, delayExact: ref.asic.delay };
        const prof = parseProfile(p);
        if (prof) out.push(prof);
    }
    return out;
}

/** Perfil em forma de objeto simples (para guardar no navegador e voltar a ler com parseProfile). */
export function serializeProfile(prof) {
    return { ...prof, asic: { area: prof.area, areaExact: prof.areaExact, delay: prof.delay, delayExact: prof.delayExact } };
}

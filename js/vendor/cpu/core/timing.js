/**
 * Período do clock e tempo de execução.
 *
 * Tempo de execução = ciclos × período. O período depende do modelo:
 *   monociclo: o caminho da instrução mais lenta do conjunto de instruções, pois o hardware precisa
 *     suportar todas elas em um único ciclo; a etapa de execução de uma classe com latência L (em ciclos
 *     de estágio) custa L vezes o atraso da ALU;
 *   pipeline (com emissão simples ou dupla): o estágio mais lento mais a sobrecarga do registrador de pipeline;
 *   Tomasulo: como o pipeline, mais uma sobrecarga opcional da lógica de escalonamento.
 * Alternativamente, o período pode vir de uma frequência digitada.
 */

/** Classes que existem no conjunto de instruções (o monociclo precisa suportar todas). */
const ISA_CLASSES = ['alu', 'mul', 'div', 'branch', 'jump', 'load', 'store', 'fadd', 'fmul', 'fdiv'];

/** Componentes do caminho de cada classe no monociclo, como pares [componente, multiplicador]. */
function singlePath(cls, latency) {
    const ex = ['alu', latency[cls] ?? 1];
    switch (cls) {
        case 'load': return [['imem', 1], ['regRead', 1], ['alu', 1], ['dmem', 1], ['regWrite', 1]];
        case 'store': return [['imem', 1], ['regRead', 1], ['alu', 1], ['dmem', 1]];
        case 'branch': return [['imem', 1], ['regRead', 1], ex];
        default: return [['imem', 1], ['regRead', 1], ex, ['regWrite', 1]];
    }
}

/**
 * Calcula o período do clock de uma configuração normalizada.
 * @returns {{periodPs: number, freqGHz: number, source: 'fixed'|'derived', critical: {kind: string, cls?: string, parts: Array}}}
 */
export function clockPeriod(cfg) {
    const tm = cfg.timing;
    if (tm.mode === 'fixed') {
        const periodPs = 1000 / tm.freqGHz;
        return { periodPs, freqGHz: tm.freqGHz, source: 'fixed', critical: { kind: 'fixed', parts: [] } };
    }
    const d = tm.delays;
    let periodPs, critical;
    if (cfg.mode === 'single') {
        let worst = null;
        for (const cls of ISA_CLASSES) {
            const parts = singlePath(cls, cfg.latency);
            const total = parts.reduce((acc, [c, m]) => acc + d[c] * m, 0);
            if (!worst || total > worst.total) worst = { cls, parts, total };
        }
        periodPs = worst.total;
        critical = { kind: 'single', cls: worst.cls, parts: worst.parts.map(([c, m]) => [c, m, d[c] * m]) };
    } else {
        const stages = ['imem', 'regRead', 'alu', 'dmem', 'regWrite'];
        const slowest = stages.reduce((a, b) => (d[b] > d[a] ? b : a));
        const extra = cfg.mode === 'pipeline' || cfg.mode === 'dual' ? 0 : d.scheduler;
        periodPs = d[slowest] + d.latch + extra;
        critical = { kind: 'stage', stage: slowest, parts: [[slowest, 1, d[slowest]], ['latch', 1, d.latch], ...(extra ? [['scheduler', 1, extra]] : [])] };
    }
    return { periodPs, freqGHz: 1000 / periodPs, source: 'derived', critical };
}

/** Acrescenta período, frequência e tempo de execução ao resultado de uma simulação. */
export function addTiming(sim) {
    const clk = clockPeriod(sim.config);
    sim.timing = { ...clk, timeNs: (sim.stats.cycles * clk.periodPs) / 1000 };
    return sim;
}

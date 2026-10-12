/**
 * Ponto de entrada da simulação: escolhe o modelo de processador conforme a configuração e acrescenta
 * o período do clock e o tempo de execução.
 */
import { normalizeConfig } from './core/config.js';
import { simulate as simulateTomasulo } from './models/tomasulo.js';
import { simulatePipeline } from './models/pipeline.js';
import { simulateSingle } from './models/single.js';
import { simulateDual } from './models/dual.js';
import { addTiming } from './core/timing.js';

/**
 * @param {object} program resultado de assemble()
 * @param {object} config configuração (parcial)
 */
export function simulate(program, config = {}) {
    const mode = normalizeConfig(config).config.mode;
    let sim;
    if (mode === 'single') sim = simulateSingle(program, config);
    else if (mode === 'pipeline') sim = simulatePipeline(program, config);
    else if (mode === 'dual') sim = simulateDual(program, config);
    else sim = simulateTomasulo(program, config);
    return sim.errors.length > 0 ? sim : addTiming(sim);
}

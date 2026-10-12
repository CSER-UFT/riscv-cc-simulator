/**
 * Configuração do processador simulado (todos os modelos).
 */
import { CLASSES } from '../riscv/isa.js';
import { t } from '../i18n/index.js';

/** Modelos de processador, na ordem de exibição. */
export const MODE_IDS = ['single', 'pipeline', 'dual', 'classic', 'rob'];
export const PREDICTOR_IDS = ['not-taken', 'taken', 'btfn', '1bit', '2bit'];
export const LATENCY_IDS = ['address', 'load', 'store', 'alu', 'branch', 'jump', 'mul', 'div', 'fadd', 'fmul', 'fdiv'];

/** Classes que precisam de estação de reserva. */
export const STATION_CLASSES = Object.keys(CLASSES).filter((c) => c !== 'system');

/** Nome traduzido de uma classe de instrução. */
export const className = (cls) => t(`class.${cls}`);

export const DEFAULT_CONFIG = {
    mode: 'classic',
    xlen: 32,
    issueWidth: 1,
    commitWidth: 1,
    cdbWidth: 1,
    robSize: 8,
    predictor: '2bit',
    bhtEntries: 16,
    queueSize: 6,
    maxCycles: 1000,
    exampleValues: true,
    storeForwarding: false,
    recovery: 'commit',
    pipeline: { forwarding: true, branchStage: 'EX' },
    timing: {
        mode: 'derived',
        freqGHz: 1,
        delays: { imem: 200, regRead: 100, alu: 200, dmem: 200, regWrite: 100, latch: 20, scheduler: 0 },
    },
    memory: {
        enabled: false,
        mainLatency: 40,
        levels: {
            L1I: { enabled: true, size: 256, blockSize: 16, assoc: 2, latency: 1 },
            L1D: { enabled: true, size: 256, blockSize: 16, assoc: 2, latency: 1 },
            L2: { enabled: true, size: 1024, blockSize: 32, assoc: 4, latency: 6 },
            L3: { enabled: false, size: 4096, blockSize: 64, assoc: 8, latency: 20 },
        },
        vm: { enabled: false, pageSize: 4096, tlbEntries: 4, tlbAssoc: 4, tlbLatency: 0, frames: 8, faultLatency: 100, preload: true },
    },
    groups: [
        { name: 'Load', count: 3, classes: ['load', 'store'], units: 0, pipelined: true },
        { name: 'Add', count: 3, classes: ['alu', 'branch', 'jump', 'fadd'], units: 0, pipelined: true },
        { name: 'Mul', count: 2, classes: ['mul', 'div', 'fmul', 'fdiv'], units: 0, pipelined: true },
    ],
    latency: {
        address: 1, load: 2, store: 1,
        alu: 1, branch: 1, jump: 1, mul: 4, div: 10,
        fadd: 2, fmul: 5, fdiv: 10,
    },
};

const intIn = (v, lo, hi, def) => {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) && n >= lo && n <= hi ? n : def;
};
const bool = (v, def) => (v === undefined ? def : Boolean(v));
const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0;

/**
 * Normaliza a hierarquia de memória. Aceita também o formato antigo, de uma única cache de dados
 * ({cache: {enabled, size, blockSize, assoc, hitLatency, missLatency}}), convertido em L1D mais memória.
 */
function normalizeMemory(partial) {
    const d = DEFAULT_CONFIG.memory;
    let pm = partial.memory;
    if (!pm && partial.cache) {
        const c = partial.cache;
        const hit = intIn(c.hitLatency, 1, 100, 1);
        pm = {
            enabled: Boolean(c.enabled),
            mainLatency: Math.max(1, intIn(c.missLatency, 1, 1000, 10) - hit),
            levels: {
                L1I: { enabled: false },
                L1D: { enabled: true, size: c.size, blockSize: c.blockSize, assoc: c.assoc, latency: hit },
                L2: { enabled: false },
                L3: { enabled: false },
            },
        };
    }
    pm ??= {};
    const levels = {};
    for (const [name, dl] of Object.entries(d.levels)) {
        const l = pm.levels?.[name] ?? {};
        levels[name] = {
            enabled: bool(l.enabled, dl.enabled),
            size: intIn(l.size, 4, 1 << 24, dl.size),
            blockSize: intIn(l.blockSize, 1, 4096, dl.blockSize),
            assoc: intIn(l.assoc, 1, 64, dl.assoc),
            latency: intIn(l.latency, 1, 1000, dl.latency),
        };
    }
    const pv = pm.vm ?? {}, dv = d.vm;
    const vm = {
        enabled: bool(pv.enabled, dv.enabled),
        pageSize: intIn(pv.pageSize, 1, 1 << 16, dv.pageSize),
        tlbEntries: intIn(pv.tlbEntries, 1, 1024, dv.tlbEntries),
        tlbAssoc: intIn(pv.tlbAssoc, 1, 1024, dv.tlbAssoc),
        tlbLatency: intIn(pv.tlbLatency, 0, 100, dv.tlbLatency),
        frames: intIn(pv.frames, 1, 4096, dv.frames),
        faultLatency: intIn(pv.faultLatency, 1, 1000000, dv.faultLatency),
        preload: bool(pv.preload, dv.preload),
    };
    return { enabled: bool(pm.enabled, d.enabled), mainLatency: intIn(pm.mainLatency, 1, 10000, d.mainLatency), levels, vm };
}

/** Normaliza o modelo de tempo de ciclo. Atrasos em picossegundos. */
function normalizeTiming(pt = {}) {
    const d = DEFAULT_CONFIG.timing;
    const delays = {};
    for (const [k, v] of Object.entries(d.delays))
        delays[k] = intIn(pt.delays?.[k], k === 'latch' || k === 'scheduler' ? 0 : 1, 100000, v);
    const f = Number(pt.freqGHz);
    return {
        mode: pt.mode === 'fixed' ? 'fixed' : 'derived',
        freqGHz: Number.isFinite(f) && f > 0 && f <= 100 ? f : d.freqGHz,
        delays,
    };
}

/**
 * Completa uma configuração parcial com os valores padrão e normaliza os campos.
 * @returns {{config: object, errors: string[]}}
 */
export function normalizeConfig(partial = {}) {
    const d = DEFAULT_CONFIG;
    const errors = [];
    const pp = partial.pipeline ?? {};
    const c = {
        mode: MODE_IDS.includes(partial.mode) ? partial.mode : d.mode,
        xlen: Number(partial.xlen) === 64 ? 64 : 32,
        issueWidth: intIn(partial.issueWidth, 1, 8, d.issueWidth),
        commitWidth: intIn(partial.commitWidth, 1, 8, d.commitWidth),
        cdbWidth: intIn(partial.cdbWidth, 1, 8, d.cdbWidth),
        robSize: intIn(partial.robSize, 1, 64, d.robSize),
        predictor: PREDICTOR_IDS.includes(partial.predictor) ? partial.predictor : d.predictor,
        bhtEntries: intIn(partial.bhtEntries, 1, 4096, d.bhtEntries),
        queueSize: intIn(partial.queueSize, 1, 32, d.queueSize),
        maxCycles: intIn(partial.maxCycles, 1, 100000, d.maxCycles),
        exampleValues: bool(partial.exampleValues, d.exampleValues),
        storeForwarding: bool(partial.storeForwarding, d.storeForwarding),
        recovery: partial.recovery === 'write' ? 'write' : 'commit',
        pipeline: {
            forwarding: bool(pp.forwarding, d.pipeline.forwarding),
            branchStage: pp.branchStage === 'ID' ? 'ID' : 'EX',
        },
        memory: normalizeMemory(partial),
        timing: normalizeTiming(partial.timing),
        latency: {},
        groups: [],
    };
    for (const k of LATENCY_IDS)
        c.latency[k] = intIn(partial.latency?.[k], 1, 100, d.latency[k]);
    // O esquema de paginação acompanha o XLEN: Sv32 no RV32 e Sv39 no RV64.
    c.memory.vm.scheme = c.xlen === 64 ? 'sv39' : 'sv32';
    if (!c.memory.enabled) c.memory.vm.enabled = false;
    if (c.memory.vm.enabled) {
        const v = c.memory.vm;
        if (!isPow2(v.pageSize) || v.pageSize < 64)
            errors.push(t('config.vmPage'));
        if (!isPow2(v.tlbEntries) || !isPow2(v.tlbAssoc) || v.tlbAssoc > v.tlbEntries)
            errors.push(t('config.vmTlb'));
    }

    if (c.memory.enabled) {
        for (const [name, l] of Object.entries(c.memory.levels)) {
            if (!l.enabled) continue;
            if (!isPow2(l.blockSize) || !isPow2(l.size) || !isPow2(l.assoc))
                errors.push(t('config.cachePow2', { level: name }));
            else if (l.blockSize * l.assoc > l.size)
                errors.push(t('config.cacheSmall', { level: name }));
        }
    }

    const names = new Set();
    for (const g of partial.groups ?? d.groups) {
        const name = String(g.name ?? '').trim().replace(/[^\w]/g, '');
        if (!name) { errors.push(t('config.groupNoName')); continue; }
        if (names.has(name)) { errors.push(t('config.groupRepeated', { name })); continue; }
        names.add(name);
        const classes = (g.classes ?? []).filter((x) => STATION_CLASSES.includes(x));
        const count = intIn(g.count, 1, 16, 1);
        const unitsRaw = intIn(g.units, 0, 16, 0);
        if (classes.length === 0) errors.push(t('config.groupNoClass', { name }));
        c.groups.push({ name, count, classes, units: unitsRaw === 0 ? null : unitsRaw, pipelined: bool(g.pipelined, true) });
    }
    if (c.groups.length === 0)
        errors.push(t('config.noGroups'));
    return { config: c, errors };
}

/**
 * Verifica, nos modelos de Tomasulo, se todas as classes de instrução usadas pelo programa têm alguma
 * estação capaz de executá-las.
 * @returns {string[]} erros
 */
export function checkProgram(program, config) {
    if (config.mode !== 'classic' && config.mode !== 'rob')
        return [];
    const served = new Set(config.groups.flatMap((g) => g.classes));
    const missing = new Map();
    for (const inst of program.instructions) {
        const cls = inst.def.cls;
        if (cls === 'system') continue;
        // Saltos incondicionais sem destino (j) são resolvidos na emissão e não precisam de estação.
        if (inst.name === 'jal' && inst.rd === 'x0') continue;
        if (!served.has(cls) && !missing.has(cls))
            missing.set(cls, inst);
    }
    return [...missing].map(([cls, inst]) => t('config.classUnserved', { cls: className(cls), inst: inst.text, line: inst.line }));
}

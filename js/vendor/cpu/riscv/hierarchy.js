/**
 * Hierarquia de memória para temporização: L1 de instruções (L1I), L1 de dados (L1D), L2 e L3 unificadas e
 * memória principal. Cada nível é associativo por conjunto, com substituição LRU e alocação na escrita.
 *
 * Os valores continuam vindo da memória (as caches só determinam latências). O preenchimento é inclusivo:
 * quando um bloco é encontrado em um nível (ou na memória principal), ele é colocado em todos os níveis
 * acima pelos quais o acesso passou. Não há custo de write-back modelado.
 *
 * Latência de um acesso: soma das latências de acesso de cada nível consultado, até o nível que acerta,
 * mais a latência da memória principal se nenhum nível acertar.
 *
 * Com memória virtual (vm.js), cada acesso começa pela tradução do endereço; as caches são consultadas
 * com o endereço físico e a latência da tradução (TLB, caminhada na tabela, falta de página) é somada.
 */
import { createVm, translate, programPages } from './vm.js';
import { STACK_TOP } from './parser.js';
import { t } from '../i18n/index.js';

export const LEVELS = ['L1I', 'L1D', 'L2', 'L3'];

/** Caminho de níveis consultados por tipo de acesso. */
export function pathFor(cfg, kind) {
    const first = kind === 'inst' ? 'L1I' : 'L1D';
    return [first, 'L2', 'L3'].filter((n) => cfg.levels[n].enabled);
}

function createLevel(lc) {
    const sets = Math.max(1, Math.floor(lc.size / (lc.blockSize * lc.assoc)));
    return {
        sets: Array.from({ length: sets }, () => Array.from({ length: lc.assoc }, () => ({ valid: false, tag: 0, lru: 0 }))),
        hits: 0,
        misses: 0,
    };
}

/**
 * Cria o estado da hierarquia (null se desabilitada).
 * @param {object} cfg configuração da hierarquia (config.memory)
 * @param {object} [program] programa montado, para pré-carregar as suas páginas na memória virtual
 */
export function createHierarchy(cfg, program = null) {
    if (!cfg.enabled) return null;
    const levels = {};
    for (const n of LEVELS)
        if (cfg.levels[n].enabled) levels[n] = createLevel(cfg.levels[n]);
    const vm = cfg.vm?.enabled
        ? createVm(cfg.vm, cfg.vm.preload ? programPages(program, cfg.vm.pageSize, STACK_TOP) : [])
        : null;
    return { levels, clock: 0, mainAccesses: 0, accesses: { inst: 0, data: 0, pte: 0 }, cycles: { inst: 0, data: 0, pte: 0 }, last: null, vm };
}

function locate(level, lc, addr) {
    const block = Number(BigInt(addr) / BigInt(lc.blockSize));
    const set = block % level.sets.length;
    const tag = Math.floor(block / level.sets.length);
    return { set, tag };
}

function lookup(level, lc, addr, clock) {
    const { set, tag } = locate(level, lc, addr);
    const way = level.sets[set].findIndex((l) => l.valid && l.tag === tag);
    if (way >= 0) level.sets[set][way].lru = clock;
    return { hit: way >= 0, set, way };
}

function fill(level, lc, addr, clock) {
    const { set, tag } = locate(level, lc, addr);
    const ways = level.sets[set];
    let way = ways.findIndex((l) => !l.valid);
    if (way < 0) {
        way = 0;
        for (let i = 1; i < ways.length; i++)
            if (ways[i].lru < ways[way].lru) way = i;
    }
    ways[way] = { valid: true, tag, lru: clock };
    return way;
}

/** Consulta os níveis da hierarquia com um endereço físico e preenche os que falharam. */
function cacheAccess(h, cfg, kind, addr) {
    const path = pathFor(cfg, kind);
    h.clock++;
    const steps = [];
    let latency = 0;
    let hitLevel = 'MEM';
    for (const name of path) {
        const level = h.levels[name], lc = cfg.levels[name];
        latency += lc.latency;
        const r = lookup(level, lc, addr, h.clock);
        steps.push({ level: name, hit: r.hit, set: r.set });
        if (r.hit) {
            level.hits++;
            hitLevel = name;
            break;
        }
        level.misses++;
    }
    if (hitLevel === 'MEM') {
        latency += cfg.mainLatency;
        h.mainAccesses++;
    }
    // Preenchimento inclusivo dos níveis que falharam
    for (const s of steps)
        if (!s.hit) fill(h.levels[s.level], cfg.levels[s.level], addr, h.clock);
    h.accesses[kind]++;
    h.cycles[kind] += latency;
    return { latency, hitLevel, path: steps };
}

/**
 * Faz um acesso e atualiza o estado.
 * @param {object} h estado da hierarquia
 * @param {object} cfg configuração da hierarquia (config.memory)
 * @param {'inst'|'data'} kind
 * @param {bigint|number} addr endereço virtual (físico se não houver memória virtual)
 * @returns {{latency: number, hitLevel: string, path: {level: string, hit: boolean, set: number}[],
 *   tr: object|null}} tr: a tradução (memória virtual), com a sua latência já incluída em latency
 */
export function access(h, cfg, kind, addr) {
    let tr = null;
    let paddr = addr;
    if (h.vm) {
        tr = translate(h.vm, cfg.vm, addr, (pa) => cacheAccess(h, cfg, 'pte', pa));
        paddr = tr.paddr;
    }
    const r = cacheAccess(h, cfg, kind, paddr);
    const latency = r.latency + (tr ? tr.latency : 0);
    h.cycles[kind] += tr ? tr.latency : 0;
    h.last = { kind, addr: String(addr), paddr: tr ? String(paddr) : null, hitLevel: r.hitLevel, latency, path: r.path.map((s) => s.level) };
    return { latency: Math.max(1, latency), hitLevel: r.hitLevel, path: r.path, tr };
}

/** Estatísticas resumidas (para a interface e para os resultados da simulação). */
export function hierarchyStats(h) {
    const out = {};
    for (const [n, l] of Object.entries(h.levels)) out[n] = { hits: l.hits, misses: l.misses };
    const vm = h.vm ? { ...h.vm.stats, pages: Object.values(h.vm.pages).filter((p) => p.present).length } : null;
    return {
        levels: out,
        ...(vm ? { vm } : {}),
        mainAccesses: h.mainAccesses,
        amatData: h.accesses.data ? h.cycles.data / h.accesses.data : 0,
        amatInst: h.accesses.inst ? h.cycles.inst / h.accesses.inst : 0,
    };
}

/** Partes da explicação de um acesso: a tradução (se houver memória virtual) e os níveis consultados. */
export function accessParts(r) {
    const parts = [];
    const tr = r.tr;
    if (tr) {
        const hex = (n) => `0x${n.toString(16)}`;
        if (tr.tlbHit) parts.push(t('mem.tlbHit', { vpn: hex(tr.vpn) }));
        else if (tr.fault) {
            parts.push(t('mem.tlbMiss', { vpn: hex(tr.vpn), n: tr.walks[0].length }));
            parts.push(t(tr.fault.evicted === null ? 'mem.fault' : 'mem.faultEvict', { frame: tr.fault.frame, old: tr.fault.evicted === null ? '' : hex(tr.fault.evicted) }));
            parts.push(t('mem.rewalk', { n: tr.walks[1].length }));
        } else parts.push(t('mem.tlbMiss', { vpn: hex(tr.vpn), n: tr.walks[0].length }));
        parts.push(t('mem.paddr', { pa: hex(tr.paddr) }));
    }
    for (const p of r.path) parts.push(t(p.hit ? 'mem.hitAt' : 'mem.missAt', { level: p.level }));
    if (r.hitLevel === 'MEM') parts.push(t('mem.main'));
    return parts;
}

/** Explicação de um acesso com a latência total, para os passos do pipeline e do Tomasulo. */
export const describeAccess = (r) => t('mem.path', { path: accessParts(r).join(', '), n: r.latency });

/**
 * Memória virtual para temporização: TLB, tabela de páginas em vários níveis (Sv32 no RV32, Sv39 no RV64)
 * e paginação sob demanda com um número limitado de quadros físicos.
 *
 * Como as caches, a memória virtual só determina latências: os valores continuam sendo lidos e escritos
 * pelo endereço virtual na memória do programa. O que muda é o endereço físico usado para consultar as
 * caches (que são indexadas e etiquetadas pelo endereço físico) e o custo de cada tradução:
 *
 *   acerto na TLB: a latência da TLB (0 por padrão, em paralelo com a L1);
 *   falha na TLB: mais uma leitura de PTE por nível, cada uma pela hierarquia de dados (L1D, L2, L3, memória);
 *   falta de página: o sistema operacional escolhe um quadro (expulsando a página usada há mais tempo se
 *     não houver quadro livre), atualiza a tabela, e a instrução é reexecutada, refazendo a caminhada.
 *
 * As tabelas de páginas ficam em uma região física própria, depois dos quadros das páginas do programa,
 * e não são paginadas.
 */

/** Geometria do esquema: bits do deslocamento, bits de cada nível (do mais alto para o mais baixo), PTE. */
export function vmGeometry(vm) {
    const sv39 = vm.scheme === 'sv39';
    const vaBits = sv39 ? 39 : 32;
    const levels = sv39 ? 3 : 2;
    const pteSize = sv39 ? 8 : 4;
    const offsetBits = Math.log2(vm.pageSize);
    const vpnBits = vaBits - offsetBits;
    const low = Math.floor(vpnBits / levels);
    const bits = [vpnBits - low * (levels - 1), ...new Array(levels - 1).fill(low)];
    return { vaBits, levels, pteSize, offsetBits, vpnBits, bits };
}

/** Índices da VPN em cada nível, do mais alto para o mais baixo. */
export function vpnIndices(geo, vpn) {
    const out = [];
    let v = vpn;
    for (let i = geo.levels - 1; i >= 0; i--) {
        const b = geo.bits[i];
        out[i] = v % 2 ** b;
        v = Math.floor(v / 2 ** b);
    }
    return out;
}

/**
 * Cria o estado da memória virtual.
 * @param {object} vm configuração (config.memory.vm)
 * @param {number[]} preload VPNs mapeadas antes do início (código, dados e pilha), em ordem
 */
export function createVm(vm, preload = []) {
    const geo = vmGeometry(vm);
    const sets = vm.tlbEntries / vm.tlbAssoc;
    const s = {
        geo,
        tlb: Array.from({ length: sets }, () => Array.from({ length: vm.tlbAssoc }, () => ({ valid: false, vpn: 0, ppn: 0, lru: 0 }))),
        pages: {}, // vpn -> {ppn, present, lastUse}
        frames: new Array(vm.frames).fill(null), // quadro -> vpn
        nodes: {}, // prefixo dos índices ("" é a raiz) -> endereço físico da tabela
        ptTop: vm.frames * vm.pageSize, // próxima posição livre da região das tabelas
        clock: 0,
        stats: { tlbHits: 0, tlbMisses: 0, walks: 0, pteReads: 0, faults: 0, evictions: 0, cycles: 0, translations: 0 },
        last: null,
    };
    s.nodes[''] = allocNode(s, vm, 0);
    for (const vpn of preload) {
        if (s.frames.every((f) => f !== null)) break;
        if (!s.pages[vpn]?.present) mapPage(s, vm, vpn);
    }
    return s;
}

function allocNode(s, vm, level) {
    const size = 2 ** s.geo.bits[level] * s.geo.pteSize;
    const align = Math.max(size, s.geo.pteSize);
    const addr = Math.ceil(s.ptTop / align) * align;
    s.ptTop = addr + size;
    return addr;
}

/** Coloca a página em um quadro (o primeiro livre, ou o da página usada há mais tempo) e cria as tabelas. */
function mapPage(s, vm, vpn) {
    const idx = vpnIndices(s.geo, vpn);
    let prefix = '';
    for (let l = 0; l < s.geo.levels - 1; l++) {
        prefix += `${prefix ? '.' : ''}${idx[l]}`;
        if (s.nodes[prefix] === undefined) s.nodes[prefix] = allocNode(s, vm, l + 1);
    }
    let frame = s.frames.indexOf(null);
    let evicted = null;
    if (frame < 0) {
        frame = 0;
        for (let i = 1; i < s.frames.length; i++)
            if (s.pages[s.frames[i]].lastUse < s.pages[s.frames[frame]].lastUse) frame = i;
        evicted = s.frames[frame];
        s.pages[evicted] = { ...s.pages[evicted], present: false, ppn: null };
        // A entrada da TLB da página expulsa deixa de valer.
        for (const ways of s.tlb) for (const e of ways) if (e.valid && e.vpn === evicted) e.valid = false;
        s.stats.evictions++;
    }
    s.frames[frame] = vpn;
    s.pages[vpn] = { ppn: frame, present: true, lastUse: s.clock };
    return { frame, evicted };
}

/** Endereço físico da PTE de `vpn` no nível `l` (null se a tabela desse nível ainda não existe). */
function pteAddress(s, idx, l) {
    const prefix = idx.slice(0, l).join('.');
    const base = s.nodes[prefix];
    return base === undefined ? null : base + idx[l] * s.geo.pteSize;
}

/**
 * Lê as PTEs nível por nível. Para no primeiro nível cuja PTE é inválida (tabela seguinte inexistente ou
 * página ausente).
 * @param {(paddr: number) => {latency: number, hitLevel: string}} readPte leitura pela hierarquia
 */
function walk(s, vpn, readPte) {
    const idx = vpnIndices(s.geo, vpn);
    const reads = [];
    let latency = 0;
    for (let l = 0; l < s.geo.levels; l++) {
        const addr = pteAddress(s, idx, l);
        const r = readPte(addr);
        latency += r.latency;
        const last = l === s.geo.levels - 1;
        const valid = last ? Boolean(s.pages[vpn]?.present) : s.nodes[idx.slice(0, l + 1).join('.')] !== undefined;
        reads.push({ level: l, index: idx[l], addr, hitLevel: r.hitLevel, latency: r.latency, valid });
        s.stats.pteReads++;
        if (!valid) return { ok: false, reads, latency };
    }
    return { ok: true, reads, latency };
}

function tlbLocate(s, vpn) {
    const set = vpn % s.tlb.length;
    return { set, way: s.tlb[set].findIndex((e) => e.valid && e.vpn === vpn) };
}

function tlbFill(s, vpn, ppn) {
    const ways = s.tlb[vpn % s.tlb.length];
    let w = ways.findIndex((e) => !e.valid);
    if (w < 0) {
        w = 0;
        for (let i = 1; i < ways.length; i++) if (ways[i].lru < ways[w].lru) w = i;
    }
    ways[w] = { valid: true, vpn, ppn, lru: s.clock };
    return w;
}

/**
 * Traduz um endereço virtual.
 * @param {object} s estado (createVm)
 * @param {object} vm configuração
 * @param {bigint|number} vaddr
 * @param {(paddr: number) => {latency: number, hitLevel: string}} readPte leitura de uma PTE pela hierarquia
 * @returns {{vaddr: string, vpn: number, offset: number, paddr: number, ppn: number, latency: number,
 *   tlbHit: boolean, tlbSet: number, walks: object[][], fault: null|{frame: number, evicted: number|null}}}
 */
export function translate(s, vm, vaddr, readPte) {
    const geo = s.geo;
    s.clock++;
    const va = Number(BigInt(vaddr) % (1n << BigInt(geo.vaBits)));
    const vpn = Math.floor(va / vm.pageSize);
    const offset = va % vm.pageSize;
    let latency = vm.tlbLatency;
    const { set, way } = tlbLocate(s, vpn);
    const out = { vaddr: String(vaddr), vpn, offset, tlbHit: way >= 0, tlbSet: set, walks: [], fault: null };
    let ppn;
    if (way >= 0) {
        s.stats.tlbHits++;
        const e = s.tlb[set][way];
        e.lru = s.clock;
        ppn = e.ppn;
    } else {
        s.stats.tlbMisses++;
        s.stats.walks++;
        let w = walk(s, vpn, readPte);
        latency += w.latency;
        out.walks.push(w.reads);
        if (!w.ok) {
            // Falta de página: o sistema operacional mapeia a página e a instrução é reexecutada.
            s.stats.faults++;
            out.fault = mapPage(s, vm, vpn);
            latency += vm.faultLatency;
            s.stats.walks++;
            w = walk(s, vpn, readPte);
            latency += w.latency;
            out.walks.push(w.reads);
        }
        ppn = s.pages[vpn].ppn;
        out.tlbWay = tlbFill(s, vpn, ppn);
    }
    s.pages[vpn].lastUse = s.clock;
    out.ppn = ppn;
    out.paddr = ppn * vm.pageSize + offset;
    out.latency = latency;
    s.stats.translations++;
    s.stats.cycles += latency;
    s.last = out;
    return out;
}

/** VPNs das páginas do programa (código, dados inicializados e topo da pilha), na ordem de carga. */
export function programPages(program, pageSize, stackTop) {
    const out = [];
    const add = (addr) => { const v = Math.floor(Number(addr) / pageSize); if (!out.includes(v)) out.push(v); };
    for (const inst of program?.instructions ?? []) add(inst.pc);
    for (const addr of program?.data?.keys?.() ?? []) add(addr);
    if (program) add(stackTop - 1);
    return out;
}

/**
 * Motor genérico do algoritmo de Tomasulo, nos modos clássico e especulativo (com buffer de reordenação).
 *
 * O motor não conhece instruções específicas: usa apenas a classe (cls), os registradores e a semântica
 * descritos em riscv/isa.js. Estações de reserva, unidades funcionais, latências, larguras de emissão,
 * de CDB e de commit, tamanho do ROB, preditor de desvios, cache e políticas de recuperação vêm da
 * configuração.
 *
 * Ordem das fases dentro de um ciclo:
 *   1. Commit (modo ROB): retira, em ordem, entradas prontas desde um ciclo anterior.
 *   2. Write result: até cdbWidth resultados prontos desde um ciclo anterior são difundidos pelo CDB,
 *      dando prioridade à instrução mais antiga.
 *   3. Execute: estações cujos operandos estavam disponíveis no início do ciclo iniciam ou continuam.
 *      As decisões desta fase usam o estado do início da fase, para não depender da ordem das estações.
 *   4. Issue: até issueWidth instruções, em ordem, desde que haja estação (e entrada no ROB) livre.
 *
 * Desambiguação de memória: endereços efetivos são calculados em ordem de programa; um load só acessa a
 * memória se nenhum store anterior pendente escreve em bytes que se sobrepõem (ou, com encaminhamento
 * habilitado, recebe o valor do store anterior mais recente que escreve exatamente os mesmos bytes); no
 * modo clássico, um store só escreve se nenhum load ou store anterior pendente acessa os mesmos bytes.
 * No modo ROB os stores escrevem na memória apenas no commit.
 */
import * as memory from '../riscv/memory.js';
import { createHierarchy, access as hierAccess, hierarchyStats, describeAccess } from '../riscv/hierarchy.js';
import { initialState, readReg, writeReg, effectiveAddress, indexAt, resolveControl } from '../riscv/machine.js';
import { TEXT_BASE } from '../riscv/parser.js';
import * as fmt from '../riscv/format.js';
import { t } from '../i18n/index.js';
import { normalizeConfig, checkProgram, className } from '../core/config.js';
import { Recorder } from '../core/recorder.js';

const MEM_CLASSES = new Set(['load', 'store']);
const ADDRESS_KNOWN = new Set(['addrDone', 'mem', 'memw', 'done']);
const FU_STAGES = new Set(['exec', 'mem', 'memw']);

/**
 * Simula o programa.
 * @param {object} program resultado de assemble()
 * @param {object} userConfig configuração (parcial)
 */
export function simulate(program, userConfig = {}) {
    const { config: cfg, errors: cfgErrors } = normalizeConfig({ ...userConfig, xlen: program.xlen });
    const errors = [...cfgErrors, ...checkProgram(program, cfg)];
    if (errors.length > 0)
        return { errors };

    const xlen = program.xlen;
    const speculative = cfg.mode === 'rob';
    const arch = initialState(program, { exampleValues: cfg.exampleValues });
    const groupByName = new Map(cfg.groups.map((g) => [g.name, g]));

    const stations = [];
    for (const g of cfg.groups)
        for (let i = 1; i <= g.count; i++)
            stations.push(emptyStation(`${g.name}${i}`, g.name, g.classes));

    const S = {
        cycle: 0,
        pc: TEXT_BASE,
        fetch: { halted: false, stall: null, resumeAt: 0 },
        regs: { x: arch.x, f: arch.f },
        status: {},
        stations,
        rob: speculative ? { head: 0, count: 0, entries: new Array(cfg.robSize).fill(null) } : null,
        mem: arch.mem,
        cdb: [],
        bht: new Array(cfg.bhtEntries).fill(cfg.predictor === '2bit' ? 1 : 0),
        cache: createHierarchy(cfg.memory, program),
        units: {},
    };

    const dyn = [];
    const stats = {
        issued: 0, committed: 0, squashed: 0, branches: 0, mispredicts: 0, stallStructural: 0, stallRob: 0,
        cdbConflicts: 0, unitConflicts: 0, forwarded: 0,
    };
    const warnings = [];

    const rec = new Recorder(userConfig.trace !== false, () => ({
        cycle: S.cycle, pc: S.pc, fetch: S.fetch, regs: S.regs, status: S.status, stations: S.stations,
        rob: S.rob, cdb: S.cdb, bht: S.bht, cache: S.cache, units: S.units, queue: queueView(),
    }), () => S.mem);
    const step = (msg, focus = []) => rec.step(msg, focus);
    const mark = (d, label) => rec.mark(d, S.cycle, label);

    function queueView() {
        const out = [];
        let pc = S.pc;
        for (let k = 0; k < cfg.queueSize; k++) {
            const i = indexAt(program, pc);
            if (i < 0) break;
            out.push(i);
            pc += 4;
        }
        return out;
    }

    // Auxiliares --------------------------------------------------------------------------------------------

    const robTag = (i) => `#${i + 1}`;
    const robIndexOfTag = (tag) => parseInt(tag.slice(1)) - 1;
    const robEntries = () => {
        const out = [];
        if (!S.rob) return out;
        for (let k = 0; k < S.rob.count; k++)
            out.push(S.rob.entries[(S.rob.head + k) % cfg.robSize]);
        return out;
    };
    const dynOf = (id) => dyn[id];
    const instOf = (st) => program.instructions[dyn[st.dyn].index];
    const code = (inst) => `\`${inst.text}\``;
    const R = (r) => `**${r}**`;
    const V = (x) => `//${fmt.value(x)}//`;
    const A = (x) => `//${fmt.address(x)}//`;
    const busyStations = () => S.stations.filter((s) => s.busy).sort((a, b) => a.dyn - b.dyn);
    const taken = (b) => t(b ? 'common.taken' : 'common.notTaken');

    const writeMemory = (addr, spec, value) => {
        S.mem = new Map(S.mem);
        memory.store(S.mem, addr, spec, value);
    };

    function readOperand(reg) {
        if (reg === null) return null;
        if (reg === 'x0') return { value: 0n, from: 'x0' };
        const tag = S.status[reg];
        if (tag === undefined) return { value: readReg(S.regs, reg), from: 'reg' };
        if (speculative) {
            const e = S.rob.entries[robIndexOfTag(tag)];
            if (e && e.ready) return { value: e.value, from: 'rob', tag };
        }
        return { tag };
    }

    function predict(inst) {
        const idx = (inst.pc >> 2) % cfg.bhtEntries;
        switch (cfg.predictor) {
            case 'taken': return true;
            case 'btfn': return inst.target <= inst.pc;
            case '1bit': return S.bht[idx] === 1;
            case '2bit': return S.bht[idx] >= 2;
            default: return false;
        }
    }

    function trainPredictor(inst, wasTaken) {
        const idx = (inst.pc >> 2) % cfg.bhtEntries;
        if (cfg.predictor === '1bit') S.bht[idx] = wasTaken ? 1 : 0;
        if (cfg.predictor === '2bit') S.bht[idx] = Math.max(0, Math.min(3, S.bht[idx] + (wasTaken ? 1 : -1)));
    }

    /** Descrição do caminho de um acesso na hierarquia, por exemplo "L1D falha, L2 acerto: 7 ciclos". */
    /** Latência de um acesso de dados: pela hierarquia, se habilitada, ou a latência fixa indicada. */
    function cacheLatency(addr, fallback) {
        if (!S.cache) return { latency: fallback, info: '' };
        const r = hierAccess(S.cache, cfg.memory, 'data', addr);
        return { latency: r.latency, info: describeAccess(r) };
    }

    /** Busca da instrução em PC pela cache de instruções; retorna verdadeiro quando ela está disponível. */
    function fetchReady(pc) {
        if (!S.cache || !cfg.memory.levels.L1I.enabled) return true;
        if (S.fetch.fetchedPc === pc) return S.cycle >= S.fetch.fetchReadyAt;
        const r = hierAccess(S.cache, cfg.memory, 'inst', pc);
        S.fetch.fetchedPc = pc;
        S.fetch.fetchReadyAt = S.cycle + r.latency - 1;
        if (r.latency > 1)
            step(t('tom.fetchMiss', { addr: A(pc), info: describeAccess(r) }), ['pc', 'cache']);
        return S.cycle >= S.fetch.fetchReadyAt;
    }

    // 1. Commit ---------------------------------------------------------------------------------------------

    function commitPhase() {
        for (let k = 0; k < cfg.commitWidth && S.rob.count > 0; k++) {
            const e = S.rob.entries[S.rob.head];
            if (!e.ready || e.readyAt >= S.cycle)
                break;
            const d = dynOf(e.dyn);
            const inst = program.instructions[d.index];
            const tag = robTag(S.rob.head);
            const focus = [`rob:${S.rob.head}`];
            let flushNow = false;

            mark(d, 'Commit');
            if (e.kind === 'store') {
                writeMemory(e.addr, inst.def.mem, e.data);
                const info = S.cache ? ' ' + cacheLatency(e.addr, 1).info : '';
                step(t('tom.commitStore', { inst: code(inst), tag, value: V(e.data), addr: A(e.addr) }) + info, [...focus, `mem:${e.addr}`]);
            } else if (e.kind === 'branch') {
                stats.branches++;
                trainPredictor(inst, e.taken);
                if (e.mispredict) {
                    stats.mispredicts++;
                    d.mispredicted = true;
                    if (e.recovered) {
                        step(t('tom.commitBranchRecovered', { inst: code(inst), tag }), focus);
                    } else {
                        flushNow = true;
                        step(t('tom.commitBranchWrong', { inst: code(inst), tag, actual: taken(e.taken), predicted: taken(e.predicted), addr: A(e.next) }), [...focus, 'pc']);
                    }
                } else {
                    step(t('tom.commitBranchOk', { inst: code(inst), tag, actual: taken(e.taken) }), focus);
                }
            } else if (e.kind === 'system') {
                S.fetch.halted = true;
                step(t('tom.commitSystem', { inst: code(inst) }), focus);
            } else if (e.dest) {
                writeReg(S.regs, e.dest, e.value);
                let extra = '';
                if (S.status[e.dest] === tag) delete S.status[e.dest];
                else if (S.status[e.dest] !== undefined) extra = ' ' + t('tom.commitNewer', { tag: S.status[e.dest] });
                step(t('tom.commitReg', { inst: code(inst), tag, reg: R(e.dest), value: V(e.value) }) + extra, [...focus, `reg:${e.dest}`]);
            } else {
                step(t('tom.commitPlain', { inst: code(inst), tag }), focus);
            }

            d.commit = S.cycle;
            stats.committed++;
            S.rob.entries[S.rob.head] = null;
            S.rob.head = (S.rob.head + 1) % cfg.robSize;
            S.rob.count--;

            if (flushNow) {
                squashAfter(null, e.next);
                break;
            }
            if (e.kind === 'system')
                break;
        }
    }

    /**
     * Descarta todas as instruções do ROB posteriores à entrada `keepUntil` (índice no ROB), ou todas se
     * for null, e redireciona a busca para `nextPc`.
     */
    function squashAfter(keepUntil, nextPc) {
        const entries = robEntries();
        const keep = keepUntil === null ? 0 : entries.findIndex((e) => e.index === keepUntil) + 1;
        const squashed = entries.slice(keep);
        const ids = new Set();
        for (const e of squashed) {
            const d = dynOf(e.dyn);
            d.squashed = S.cycle;
            ids.add(d.id);
            mark(d, 'Descartada');
            stats.squashed++;
            S.rob.entries[e.index] = null;
        }
        S.rob.count = keep;
        for (const st of S.stations)
            if (st.busy && ids.has(st.dyn))
                Object.assign(st, emptyStation(st.name, st.group, st.classes));
        // Reconstrói a tabela de status a partir das entradas que permaneceram (em ordem de programa).
        S.status = {};
        for (const e of entries.slice(0, keep))
            if (e.kind === 'reg' && e.dest) S.status[e.dest] = robTag(e.index);
        S.pc = nextPc;
        S.fetch = { halted: false, stall: null, resumeAt: S.cycle + 1 };
        step(t('tom.squash', { n: squashed.length }), ['rob', 'pc']);
    }

    // 2. Write result ---------------------------------------------------------------------------------------

    function usesCdb(inst) {
        if (inst.def.cls === 'branch' || inst.def.cls === 'store') return false;
        return inst.rd !== null && inst.rd !== 'x0';
    }

    function broadcast(tag, value, sourceName) {
        const receivers = [];
        for (const st of S.stations) {
            if (!st.busy) continue;
            for (const side of ['j', 'k', 'm']) {
                if (st[`Q${side}`] === tag) {
                    st[`V${side}`] = value;
                    st[`Q${side}`] = null;
                    st[`${side}ReadyAt`] = S.cycle + 1;
                    receivers.push(`**${st.name}**.V${side}`);
                }
            }
        }
        const regs = [];
        if (!speculative) {
            for (const reg of Object.keys(S.status)) {
                if (S.status[reg] === tag) {
                    writeReg(S.regs, reg, value);
                    delete S.status[reg];
                    receivers.push(R(reg));
                    regs.push(reg);
                }
            }
        }
        S.cdb.push({ from: sourceName, tag, value });
        return { receivers, regs };
    }

    function redirect(nextPc) {
        S.pc = nextPc;
        S.fetch.stall = null;
        S.fetch.resumeAt = S.cycle + 1;
    }

    function writePhase() {
        const ready = busyStations().filter((st) => st.stage === 'done' && st.doneAt < S.cycle).map((st) => [st, st.dyn]);
        let used = 0;
        const waiting = [];
        for (const [st, id] of ready) {
            if (!st.busy || st.dyn !== id) continue; // descartada por uma recuperação neste ciclo
            const inst = instOf(st);
            const d = dynOf(st.dyn);
            const needsCdb = usesCdb(inst);
            if (needsCdb && used >= cfg.cdbWidth) {
                waiting.push(st);
                continue;
            }
            if (needsCdb) used++;
            const tag = speculative ? robTag(st.rob) : st.name;
            const focus = [`st:${st.name}`];
            let msg;
            let recover = null;

            if (speculative) {
                const e = S.rob.entries[st.rob];
                e.ready = true;
                e.readyAt = S.cycle;
                focus.push(`rob:${st.rob}`);
                if (inst.def.cls === 'store') {
                    e.addr = st.addr;
                    e.data = st.Vk;
                    msg = t('tom.writeStoreRob', { inst: code(inst), st: st.name, value: V(st.Vk), addr: A(st.addr), tag });
                } else if (inst.def.cls === 'branch') {
                    e.taken = st.result.taken;
                    e.next = st.result.next;
                    e.mispredict = e.next !== e.predictedNext;
                    const p = { inst: code(inst), st: st.name, actual: taken(e.taken), predicted: taken(e.predicted) };
                    if (e.mispredict && cfg.recovery === 'write') {
                        e.recovered = true;
                        recover = e;
                        msg = t('tom.writeBranchRecoverNow', p);
                    } else {
                        msg = t(e.mispredict ? 'tom.writeBranchWrong' : 'tom.writeBranchOk', p);
                    }
                } else {
                    e.value = st.result.value;
                    let r = { receivers: [] };
                    if (needsCdb) {
                        r = broadcast(tag, e.value, st.name);
                        focus.push('cdb');
                    }
                    msg = needsCdb
                        ? t('tom.writeRobCdb', { st: st.name, value: V(e.value), inst: code(inst), tag, to: r.receivers.length ? r.receivers.join(', ') : t('tom.nobody') })
                        : t('tom.writeRob', { st: st.name, value: V(e.value), inst: code(inst), tag });
                    if (inst.name === 'jalr') {
                        redirect(st.result.next);
                        msg += ' ' + t('tom.jalrResume', { addr: A(S.pc) });
                        focus.push('pc');
                    }
                }
            } else if (inst.def.cls === 'branch') {
                redirect(st.result.next);
                stats.branches++;
                msg = t('tom.writeBranchClassic', { inst: code(inst), st: st.name, actual: taken(st.result.taken), addr: A(S.pc) });
                focus.push('pc');
            } else {
                const value = st.result.value;
                if (needsCdb) {
                    const r = broadcast(tag, value, st.name);
                    focus.push('cdb', ...r.regs.map((x) => `reg:${x}`));
                    msg = t('tom.writeCdb', { st: st.name, value: V(value), inst: code(inst), to: r.receivers.length ? r.receivers.join(', ') : t('tom.nobody') });
                } else {
                    msg = t('tom.writeNoDest', { st: st.name, inst: code(inst) });
                }
                if (inst.name === 'jalr') {
                    redirect(st.result.next);
                    msg += ' ' + t('tom.jalrResume', { addr: A(S.pc) });
                    focus.push('pc');
                }
            }
            d.write = S.cycle;
            mark(d, 'Write');
            Object.assign(st, emptyStation(st.name, st.group, st.classes));
            msg += ' ' + t('tom.stationFreed', { st: st.name });
            step(msg, focus);
            if (recover)
                squashAfter(recover.index, recover.next);
        }
        if (waiting.length > 0) {
            stats.cdbConflicts += waiting.length;
            step(t('tom.cdbBusy', { list: waiting.map((s) => `**${s.name}**`).join(', ') }), waiting.map((s) => `st:${s.name}`));
        }
    }

    // 3. Execute --------------------------------------------------------------------------------------------

    const sideReady = (st, side) => st[`Q${side}`] === null && st[`${side}ReadyAt`] <= S.cycle;
    const operandsReady = (st) => sideReady(st, 'j') && sideReady(st, 'k') && sideReady(st, 'm');

    function olderMemAddressesKnown(st) {
        return S.stations.every((o) => !o.busy || o.dyn >= st.dyn || !MEM_CLASSES.has(o.cls) || ADDRESS_KNOWN.has(o.stage));
    }

    const memSpec = (dynId) => program.instructions[dyn[dynId].index].def.mem;

    /**
     * Decide o acesso de um load: null (memória livre), {wait: nome} ou {forward: valor, from: nome}.
     */
    function loadSource(st) {
        const a = st.addr, sa = memSpec(st.dyn).size;
        let youngest = null;
        const consider = (dynId, addr, name, dataReady, data) => {
            if (dynId >= st.dyn || addr === null) return;
            if (!memory.overlaps(a, sa, addr, memSpec(dynId).size)) return;
            if (!youngest || dynId > youngest.dynId)
                youngest = { dynId, addr, name, dataReady, data };
        };
        for (const o of S.stations)
            if (o.busy && o.cls === 'store')
                consider(o.dyn, o.addr, o.name, sideReady(o, 'k'), o.Vk);
        if (speculative)
            for (const e of robEntries())
                if (e.kind === 'store' && e.addr !== null)
                    consider(e.dyn, e.addr, `ROB ${robTag(e.index)}`, true, e.data);
        if (!youngest) return null;
        if (cfg.storeForwarding && youngest.addr === a && memSpec(youngest.dynId).size === sa && youngest.dataReady) {
            const tmp = new Map();
            memory.store(tmp, a, memSpec(youngest.dynId), youngest.data);
            return { forward: memory.load(tmp, a, memSpec(st.dyn), xlen), from: youngest.name };
        }
        return { wait: youngest.name };
    }

    function storeConflict(st) {
        const a = st.addr, sa = memSpec(st.dyn).size;
        for (const o of S.stations) {
            if (!o.busy || o.dyn >= st.dyn || !MEM_CLASSES.has(o.cls)) continue;
            if (o.cls === 'load' && o.stage === 'done') continue;
            if (memory.overlaps(a, sa, o.addr, memSpec(o.dyn).size)) return o.name;
        }
        return null;
    }

    function finishExecution(st, inst) {
        const d = inst.def;
        if (d.cls === 'branch' || d.cls === 'jump') {
            const r = resolveControl(inst, st.Vj, st.Vk, xlen);
            st.result = { taken: r.taken, next: r.next, value: r.value };
            return d.cls === 'branch'
                ? taken(r.taken)
                : t('tom.jumpResult', { reg: R(inst.rd), value: fmt.value(r.value), addr: fmt.address(r.next) });
        }
        st.result = { value: d.exec(st.Vj, st.Vk, inst, xlen, st.Vm) };
        return V(st.result.value);
    }

    function executePhase() {
        const busy = busyStations();
        const actions = [];
        const waits = [];
        for (const st of busy) {
            switch (st.stage) {
                case 'issued':
                    if (st.issuedAt >= S.cycle) break;
                    if (MEM_CLASSES.has(st.cls)) {
                        if (sideReady(st, 'j') && olderMemAddressesKnown(st))
                            actions.push(['startAddr', st]);
                    } else if (operandsReady(st)) {
                        actions.push(['startExec', st]);
                    }
                    break;
                case 'addrDone':
                    if (st.addrAt >= S.cycle) break;
                    if (st.cls === 'load') {
                        const src = loadSource(st);
                        if (src === null) actions.push(['startMem', st]);
                        else if (src.forward !== undefined) actions.push(['forward', st, src]);
                        else waits.push(t('tom.waitLoad', { st: st.name, other: src.wait, addr: fmt.address(st.addr) }));
                    } else if (sideReady(st, 'k')) {
                        if (speculative) {
                            actions.push(['storeReady', st]);
                        } else {
                            const c = storeConflict(st);
                            if (c === null) actions.push(['startMemWrite', st]);
                            else waits.push(t('tom.waitStore', { st: st.name, other: c, addr: fmt.address(st.addr) }));
                        }
                    }
                    break;
                case 'exec': case 'addr': case 'mem': case 'memw':
                    actions.push(['continue', st]);
                    break;
            }
        }

        // Unidades funcionais compartilhadas: ocupadas pelas operações em andamento (unidades sem pipeline) e
        // pelas que iniciam neste ciclo.
        const unitsUsed = {};
        for (const g of cfg.groups)
            unitsUsed[g.name] = g.pipelined ? 0 : busy.filter((s) => s.group === g.name && FU_STAGES.has(s.stage) && !s.forwarding).length;
        const needsUnit = new Set(['startExec', 'startMem', 'startMemWrite']);

        const progress = [];
        for (const [action, st, extra] of actions) {
            const inst = instOf(st);
            const d = dynOf(st.dyn);
            const g = groupByName.get(st.group);
            if (needsUnit.has(action) && g.units !== null) {
                if (unitsUsed[g.name] >= g.units) {
                    stats.unitConflicts++;
                    st.waitingUnit = true;
                    waits.push(t('tom.waitUnit', { st: st.name, group: g.name }));
                    continue;
                }
                unitsUsed[g.name]++;
            }
            st.waitingUnit = false;
            switch (action) {
                case 'startExec':
                    st.stage = 'exec';
                    st.total = cfg.latency[st.cls];
                    st.remaining = st.total;
                    d.execStart ??= S.cycle;
                    step(t('tom.startExec', { st: st.name, inst: code(inst), lat: st.total }), [`st:${st.name}`]);
                    break;
                case 'startAddr':
                    st.stage = 'addr';
                    st.total = cfg.latency.address;
                    st.remaining = st.total;
                    d.execStart ??= S.cycle;
                    break;
                case 'startMem': {
                    const c = cacheLatency(st.addr, cfg.latency.load);
                    st.stage = 'mem';
                    st.total = c.latency;
                    st.remaining = st.total;
                    step(t('tom.startMem', { st: st.name, addr: A(st.addr) }) + (c.info ? ' ' + c.info : ''),
                        [`st:${st.name}`, `mem:${st.addr}`, ...(S.cache ? ['cache'] : [])]);
                    break;
                }
                case 'forward':
                    st.stage = 'mem';
                    st.total = 1;
                    st.remaining = 1;
                    st.forwarding = true;
                    st.forwardValue = extra.forward;
                    stats.forwarded++;
                    step(t('tom.forward', { st: st.name, other: extra.from, value: V(extra.forward), addr: A(st.addr) }), [`st:${st.name}`]);
                    break;
                case 'startMemWrite': {
                    const c = cacheLatency(st.addr, cfg.latency.store);
                    st.stage = 'memw';
                    st.total = c.latency;
                    st.remaining = st.total;
                    if (c.info) step(t('tom.startStore', { st: st.name, addr: A(st.addr) }) + ' ' + c.info, [`st:${st.name}`, 'cache']);
                    break;
                }
                case 'storeReady':
                    st.stage = 'done';
                    st.doneAt = S.cycle;
                    d.execEnd = S.cycle;
                    step(t('tom.storeReady', { st: st.name, value: V(st.Vk), inst: code(inst) }), [`st:${st.name}`]);
                    continue;
            }
            // Avança um ciclo da operação em andamento.
            st.remaining--;
            mark(d, st.stage === 'memw' ? 'Write' : (st.stage === 'mem' ? 'Mem' : 'Exec'));
            if (st.remaining > 0) {
                progress.push(st.name);
                continue;
            }
            switch (st.stage) {
                case 'exec': {
                    const r = finishExecution(st, inst);
                    st.stage = 'done';
                    st.doneAt = S.cycle;
                    d.execEnd = S.cycle;
                    step(t('tom.endExec', { st: st.name, inst: code(inst), result: r }), [`st:${st.name}`]);
                    break;
                }
                case 'addr':
                    st.addr = effectiveAddress(inst, st.Vj, xlen);
                    d.addr = st.addr;
                    st.stage = 'addrDone';
                    st.addrAt = S.cycle;
                    step(t('tom.address', { st: st.name, inst: code(inst), base: fmt.value(st.Vj), off: inst.imm, addr: A(st.addr) }), [`st:${st.name}`]);
                    break;
                case 'mem':
                    st.result = { value: st.forwarding ? st.forwardValue : memory.load(S.mem, st.addr, inst.def.mem, xlen) };
                    st.stage = 'done';
                    st.doneAt = S.cycle;
                    d.execEnd = S.cycle;
                    step(t(st.forwarding ? 'tom.forwardDone' : 'tom.loadDone', { st: st.name, value: V(st.result.value), addr: A(st.addr) }),
                        [`st:${st.name}`, `mem:${st.addr}`]);
                    break;
                case 'memw': {
                    const value = st.Vk, addr = st.addr;
                    writeMemory(addr, inst.def.mem, value);
                    d.write = S.cycle;
                    Object.assign(st, emptyStation(st.name, st.group, st.classes));
                    step(t('tom.storeDone', { inst: code(inst), value: V(value), addr: A(addr), st: st.name }), [`st:${st.name}`, `mem:${addr}`]);
                    break;
                }
            }
        }
        S.units = unitsUsed;
        if (progress.length > 0) {
            const list = progress.map((n) => {
                const st = S.stations.find((s) => s.name === n);
                return t('tom.progressItem', { st: n, done: st.total - st.remaining, total: st.total });
            });
            step(t('tom.progress', { list: list.join(', ') }), progress.map((n) => `st:${n}`));
        }
        if (waits.length > 0)
            step(t('tom.waits', { list: waits.join('; ') }), []);
    }

    // 4. Issue ----------------------------------------------------------------------------------------------

    function allocRob(d, kind, dest) {
        const i = (S.rob.head + S.rob.count) % cfg.robSize;
        S.rob.entries[i] = {
            index: i, dyn: d.id, kind, dest, value: null, ready: false, readyAt: null, issuedAt: S.cycle,
            addr: null, data: null, taken: null, predicted: null, predictedNext: null, next: null,
            mispredict: false, recovered: false,
        };
        S.rob.count++;
        d.rob = i;
        return i;
    }

    function newDyn(inst) {
        const d = {
            id: dyn.length, index: inst.index, pc: inst.pc, text: inst.text, issue: S.cycle,
            execStart: null, execEnd: null, write: null, commit: null, squashed: null,
            station: null, rob: null, addr: null, mispredicted: false, marks: [],
        };
        dyn.push(d);
        stats.issued++;
        return d;
    }

    function issueOne(inst) {
        const def = inst.def;
        const robFull = speculative && S.rob.count >= cfg.robSize;

        // Instruções de sistema e saltos incondicionais sem retorno não ocupam estação de reserva.
        if (def.cls === 'system' || (inst.name === 'jal' && inst.rd === 'x0')) {
            if (robFull) {
                stats.stallRob++;
                step(t('tom.robFull', { inst: code(inst) }), ['rob']);
                return false;
            }
            const d = newDyn(inst);
            mark(d, 'Issue');
            if (speculative) {
                const i = allocRob(d, def.cls === 'system' ? 'system' : 'jump', null);
                S.rob.entries[i].ready = true;
                S.rob.entries[i].readyAt = S.cycle;
            }
            if (def.cls === 'system') {
                S.fetch.halted = true;
                step(t('tom.issueSystem', { inst: code(inst) }), ['pc']);
                return false;
            }
            S.pc = inst.target;
            step(t('tom.issueJump', { inst: code(inst), addr: A(S.pc) }), ['pc']);
            return true;
        }

        const st = S.stations.find((s) => !s.busy && s.classes.includes(def.cls));
        if (!st) {
            stats.stallStructural++;
            step(t('tom.noStation', { inst: code(inst), cls: className(def.cls) }),
                S.stations.filter((s) => s.classes.includes(def.cls)).map((s) => `st:${s.name}`));
            return false;
        }
        if (robFull) {
            stats.stallRob++;
            step(t('tom.robFull', { inst: code(inst) }), ['rob']);
            return false;
        }

        const d = newDyn(inst);
        d.station = st.name;
        const dest = inst.rd !== null && inst.rd !== 'x0' ? inst.rd : null;

        Object.assign(st, {
            busy: true, dyn: d.id, op: inst.name, cls: def.cls, issuedAt: S.cycle, stage: 'issued',
            imm: inst.imm, kImm: false, jUsed: inst.rs1 !== null, kUsed: inst.rs2 !== null, mUsed: inst.rs3 !== null,
        });

        // Leitura dos operandos (antes de marcar o destino, para casos como addi a0, a0, 4).
        const opMsgs = [];
        const srcFocus = [];
        const setOperand = (side, reg) => {
            const Vn = `V${side}`, Qn = `Q${side}`, at = `${side}ReadyAt`;
            const r = readOperand(reg);
            if (r === null) { st[Vn] = null; st[Qn] = null; st[at] = 0; return; }
            srcFocus.push(`reg:${reg}`);
            if (r.value === undefined) {
                st[Qn] = r.tag; st[Vn] = null; st[at] = Infinity;
                opMsgs.push(t('tom.opWait', { side: Vn, reg: R(reg), tag: r.tag }));
            } else {
                st[Vn] = r.value; st[Qn] = null; st[at] = S.cycle + 1;
                const src = r.from === 'rob' ? t('tom.srcRob', { tag: r.tag }) : t(r.from === 'x0' ? 'tom.srcZero' : 'tom.srcReg');
                opMsgs.push(t('tom.opValue', { side: Vn, value: V(r.value), reg: R(reg), src }));
            }
        };
        setOperand('j', inst.rs1);
        setOperand('k', inst.rs2);
        setOperand('m', inst.rs3);
        if (inst.rs2 === null && !MEM_CLASSES.has(def.cls) && ['I', 'SH', 'U', 'J', 'JR'].includes(def.fmt)) {
            st.Vk = BigInt(inst.imm);
            st.kImm = true;
            if (def.fmt === 'I' || def.fmt === 'SH') opMsgs.push(t('tom.opImm', { value: V(BigInt(inst.imm)) }));
        }
        if (MEM_CLASSES.has(def.cls))
            opMsgs.push(t('tom.opOffset', { value: V(BigInt(inst.imm)) }));

        let robIdx = null;
        if (speculative) {
            const kind = def.cls === 'store' ? 'store' : (def.cls === 'branch' ? 'branch' : 'reg');
            robIdx = allocRob(d, kind, kind === 'reg' ? dest : null);
            st.rob = robIdx;
        }

        mark(d, 'Issue');
        step(speculative
            ? t('tom.issueRob', { inst: code(inst), st: st.name, tag: robTag(robIdx) })
            : t('tom.issue', { inst: code(inst), st: st.name }),
        [`st:${st.name}`, 'queue', ...(speculative ? [`rob:${robIdx}`] : [])]);
        if (opMsgs.length > 0)
            step(t('tom.operands', { st: st.name, list: opMsgs.join('; ') }), [`st:${st.name}`, ...srcFocus]);

        if (dest !== null) {
            const tag = speculative ? robTag(robIdx) : st.name;
            const previous = S.status[dest];
            S.status[dest] = tag;
            step(t(previous !== undefined ? 'tom.renameAgain' : 'tom.rename', { reg: R(dest), tag, previous }), [`reg:${dest}`]);
        }

        // Controle de fluxo
        if (def.cls === 'branch') {
            if (speculative) {
                const e = S.rob.entries[robIdx];
                e.predicted = predict(inst);
                e.predictedNext = e.predicted ? inst.target : inst.pc + 4;
                S.pc = e.predictedNext;
                step(t('tom.predict', { predictor: t(`predictor.${cfg.predictor}`), dir: taken(e.predicted), addr: A(S.pc) }), ['pc']);
                return true;
            }
            S.fetch.stall = { dyn: d.id };
            step(t('tom.branchStall', { inst: code(inst) }), ['pc']);
            return false;
        }
        if (inst.name === 'jal') {
            S.pc = inst.target;
            return true;
        }
        if (inst.name === 'jalr') {
            S.fetch.stall = { dyn: d.id };
            step(t('tom.jalrStall', { inst: code(inst) }), ['pc']);
            return false;
        }
        S.pc += 4;
        return true;
    }

    function issuePhase() {
        for (let k = 0; k < cfg.issueWidth; k++) {
            if (S.fetch.halted) return;
            if (S.fetch.stall) {
                if (k === 0) step(t('tom.issueStopped', { inst: `\`${dynOf(S.fetch.stall.dyn).text}\`` }), ['pc']);
                return;
            }
            if (S.fetch.resumeAt > S.cycle) return;
            const i = indexAt(program, S.pc);
            if (i < 0) return;
            if (!fetchReady(S.pc)) return;
            if (!issueOne(program.instructions[i])) return;
        }
    }

    // Laço principal ----------------------------------------------------------------------------------------

    const isDone = () =>
        S.stations.every((s) => !s.busy) && (!S.rob || S.rob.count === 0) &&
        (S.fetch.halted || (indexAt(program, S.pc) < 0 && !S.fetch.stall));

    rec.endCycle();
    while (!isDone()) {
        if (S.cycle >= cfg.maxCycles) {
            warnings.push(t('common.maxCycles', { n: cfg.maxCycles }));
            break;
        }
        S.cycle++;
        S.cdb = [];
        rec.beginCycle();
        if (speculative) commitPhase();
        writePhase();
        executePhase();
        issuePhase();
        rec.endCycle(t('common.endOfCycle'));
    }

    const committed = speculative ? stats.committed : stats.issued;
    if (S.cache) stats.memory = hierarchyStats(S.cache);
    return {
        errors: [],
        model: cfg.mode,
        config: cfg,
        program,
        states: rec.states,
        interStates: rec.interStates,
        dyn,
        warnings,
        finished: isDone(),
        stats: { ...stats, cycles: S.cycle, instructions: committed, ipc: S.cycle > 0 ? committed / S.cycle : 0 },
        final: { x: S.regs.x, f: S.regs.f, mem: S.mem },
    };
}

function emptyStation(name, group, classes) {
    return {
        name, group, classes, busy: false, dyn: null, op: null, cls: null,
        Vj: null, Vk: null, Vm: null, Qj: null, Qk: null, Qm: null, jReadyAt: 0, kReadyAt: 0, mReadyAt: 0,
        jUsed: false, kUsed: false, mUsed: false, kImm: false,
        imm: null, addr: null, addrAt: null, rob: null, forwarding: false, forwardValue: null, waitingUnit: false,
        stage: null, remaining: 0, total: 0, result: null, issuedAt: null, doneAt: null,
    };
}

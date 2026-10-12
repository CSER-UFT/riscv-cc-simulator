/**
 * Pipeline de 5 estágios com emissão dupla estática, como na seção 4.10 do Patterson e Hennessy.
 *
 * A cada ciclo entra um pacote de emissão com dois slots: o slot 0 recebe uma instrução de ALU ou de
 * desvio (também multiplicação, divisão e ponto flutuante), e o slot 1 recebe um load ou um store. O
 * pacote é formado em ordem de programa, como faria um compilador que não reordena o código: a próxima
 * instrução ocupa o slot do seu tipo e a seguinte entra no outro slot se for do tipo complementar e
 * independente da primeira; caso contrário, o slot vazio leva um nop. Um desvio ou salto fecha o pacote
 * (a instrução depois dele está em outro caminho), mas pode entrar no slot 0 junto com um load ou store
 * que o precede. Para usar melhor os dois slots, o aluno reordena o código, como no exemplo do livro.
 *
 * O pacote avança inteiro pelos estágios: se uma das duas instruções precisa esperar (dependência, unidade
 * ocupada, memória), as duas esperam. O banco de registradores tem quatro portas de leitura e duas de
 * escrita, e há um somador extra para o endereço dos acessos à memória. O encaminhamento vem dos dois
 * slots de EX/MEM e MEM/WB; o resultado de um load ainda custa um ciclo de parada para o pacote seguinte,
 * que agora tem duas instruções que poderiam ter sido emitidas.
 *
 * As opções do pipeline (encaminhamento, estágio de resolução dos desvios, previsor, latências e
 * hierarquia de memória) valem também aqui.
 */
import * as memory from '../riscv/memory.js';
import { createHierarchy, access as hierAccess, hierarchyStats, describeAccess } from '../riscv/hierarchy.js';
import { initialState, readReg, writeReg, effectiveAddress, indexAt, resolveControl } from '../riscv/machine.js';
import { TEXT_BASE } from '../riscv/parser.js';
import * as fmt from '../riscv/format.js';
import { t } from '../i18n/index.js';
import { normalizeConfig } from '../core/config.js';
import { Recorder } from '../core/recorder.js';

export const STAGES = ['IF', 'ID', 'EX', 'MEM', 'WB'];

/** Slot de uma instrução: 1 para load e store, 0 para as demais. */
export const slotOf = (inst) => (inst.def.cls === 'load' || inst.def.cls === 'store' ? 1 : 0);

const isControl = (inst) => inst.def.cls === 'branch' || inst.def.cls === 'jump';
const destReg = (inst) => (inst.rd && inst.rd !== 'x0' ? inst.rd : null);
const srcRegs = (inst) => [inst.rs1, inst.rs2, inst.rs3].filter((r) => r && r !== 'x0');

/**
 * Forma o pacote que começa na instrução i: devolve os índices das instruções (em ordem de programa) e,
 * quando há só uma, o motivo do slot vazio.
 */
export function formPacket(program, i) {
    const X = program.instructions[i];
    if (X.def.cls === 'system') return { members: [i], reason: 'system' };
    if (isControl(X)) return { members: [i], reason: 'control' };
    const j = indexAt(program, X.pc + 4);
    if (j < 0) return { members: [i], reason: 'end' };
    const Y = program.instructions[j];
    if (Y.def.cls === 'system') return { members: [i], reason: 'system' };
    if (slotOf(Y) === slotOf(X)) return { members: [i], reason: 'sameKind', other: j };
    const d = destReg(X);
    if (d && srcRegs(Y).includes(d)) return { members: [i], reason: 'raw', other: j, reg: d };
    if (d && destReg(Y) === d) return { members: [i], reason: 'waw', other: j, reg: d };
    return { members: [i, j], reason: null };
}

export function simulateDual(program, userConfig = {}) {
    const { config: cfg, errors } = normalizeConfig({ ...userConfig, xlen: program.xlen });
    if (errors.length > 0) return { errors };
    const xlen = program.xlen;
    const fwd = cfg.pipeline.forwarding;
    const branchInId = cfg.pipeline.branchStage === 'ID';
    const arch = initialState(program, { exampleValues: cfg.exampleValues });

    const S = {
        cycle: 0,
        pc: TEXT_BASE,
        halted: false,
        regs: { x: arch.x, f: arch.f },
        mem: arch.mem,
        cache: createHierarchy(cfg.memory, program),
        bht: new Array(cfg.bhtEntries).fill(cfg.predictor === '2bit' ? 1 : 0),
        // Cada estágio guarda um pacote {slots: [slot0, slot1], ...} ou null.
        stages: { IF: null, ID: null, EX: null, MEM: null, WB: null },
        forwards: [],
        hazard: null,
    };
    const dyn = [];
    const stats = {
        instructions: 0, packets: 0, dualPackets: 0, emptySlots: 0, branches: 0, mispredicts: 0,
        dataStalls: 0, structStalls: 0, flushed: 0, forwards: 0,
    };
    const warnings = [];

    const rec = new Recorder(userConfig.trace !== false, () => ({
        cycle: S.cycle, pc: S.pc, halted: S.halted, regs: S.regs, cache: S.cache, bht: S.bht,
        stages: STAGES.map((st) => S.stages[st] && publicPacket(S.stages[st])),
        forwards: S.forwards, hazard: S.hazard,
    }), () => S.mem);
    const step = (msg, focus = []) => rec.step(msg, focus);
    const mark = (slot, label) => rec.mark(dyn[slot.dyn], S.cycle, label);

    const instOf = (slot) => program.instructions[slot.index];
    const code = (slot) => `\`${instOf(slot).text}\``;
    const V = (x) => `//${fmt.value(x)}//`;
    const A = (x) => `//${fmt.address(x)}//`;
    const R = (r) => `**${r}**`;
    const taken = (b) => t(b ? 'common.taken' : 'common.notTaken');
    const slotsOf = (p) => (p ? p.slots.filter(Boolean) : []);

    function publicSlot(s) {
        return {
            dyn: s.dyn, index: s.index, a: s.a, b: s.b, c: s.c, result: s.result, addr: s.addr,
            remaining: s.remaining, total: s.total, done: s.done, stalled: s.stalled, taken: s.taken, next: s.next,
            predicted: s.predicted, predictedNext: s.predictedNext,
        };
    }
    function publicPacket(p) {
        return { slots: p.slots.map((s) => s && publicSlot(s)), ifRemaining: p.ifRemaining, ifTotal: p.ifTotal, stalled: p.stalled, reason: p.reason };
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
    function train(inst, wasTaken) {
        const idx = (inst.pc >> 2) % cfg.bhtEntries;
        if (cfg.predictor === '1bit') S.bht[idx] = wasTaken ? 1 : 0;
        if (cfg.predictor === '2bit') S.bht[idx] = Math.max(0, Math.min(3, S.bht[idx] + (wasTaken ? 1 : -1)));
    }

    const isLoad = (slot) => instOf(slot).def.cls === 'load';
    const destOf = (slot) => destReg(instOf(slot));

    /** Produtor mais recente (EX, depois MEM, depois WB) de um registrador, em qualquer slot. */
    function producer(reg) {
        for (const st of ['EX', 'MEM', 'WB'])
            for (const s of slotsOf(S.stages[st]))
                if (destOf(s) === reg) return { slot: s, stage: st };
        return null;
    }

    function operandForEx(reg, field, slot) {
        if (reg === null) return null;
        if (reg === 'x0') return 0n;
        if (fwd) {
            for (const [st, latch] of [['MEM', 'EX/MEM'], ['WB', 'MEM/WB']]) {
                for (const p of slotsOf(S.stages[st])) {
                    if (destOf(p) === reg && p.resultReady) {
                        S.forwards.push({ to: field, from: latch, reg, value: p.result, dyn: slot.dyn, slot: slot.slot, fromSlot: p.slot });
                        stats.forwards++;
                        return p.result;
                    }
                }
            }
        }
        return readReg(S.regs, reg);
    }

    function flushPacket(stage, reason) {
        const p = S.stages[stage];
        if (!p) return;
        for (const s of slotsOf(p)) {
            dyn[s.dyn].squashed = S.cycle;
            mark(s, 'Descartada');
            stats.flushed++;
            step(t('pipe.flush', { inst: code(s), stage, reason }), [`stage:${stage}`]);
        }
        S.stages[stage] = null;
    }

    function resolveBranch(slot, a, b, stage) {
        const inst = instOf(slot);
        const r = resolveControl(inst, a, b, xlen);
        slot.taken = r.taken;
        slot.next = r.next;
        if (r.value !== null) slot.result = r.value;
        if (inst.def.cls === 'branch') {
            stats.branches++;
            train(inst, r.taken);
        }
        if (r.next !== slot.predictedNext) {
            if (inst.def.cls === 'branch') stats.mispredicts++;
            dyn[slot.dyn].mispredicted = true;
            step(t('pipe.redirect', { inst: code(slot), stage, dir: taken(r.taken), addr: A(r.next) }), [`stage:${stage}`, 'pc']);
            const reason = t('pipe.reasonBranch');
            if (stage === 'EX') flushPacket('ID', reason);
            flushPacket('IF', reason);
            S.pc = r.next;
            S.halted = false;
        } else if (inst.def.cls === 'branch') {
            step(t('pipe.branchOk', { inst: code(slot), stage, dir: taken(r.taken) }), [`stage:${stage}`]);
        }
    }

    // Trabalho de cada estágio no ciclo -------------------------------------------------------------------

    function doWB() {
        for (const s of slotsOf(S.stages.WB)) {
            const inst = instOf(s);
            mark(s, 'WB');
            stats.instructions++;
            dyn[s.dyn].commit = S.cycle;
            const dest = destOf(s);
            if (dest && s.result !== null) {
                writeReg(S.regs, dest, s.result);
                step(t('pipe.wb', { inst: code(s), reg: R(dest), value: V(s.result) }), ['stage:WB', `slot:${s.slot}`, `reg:${dest}`]);
            } else if (inst.def.cls === 'system') {
                step(t('pipe.wbSystem', { inst: code(s) }), ['stage:WB']);
            } else {
                step(t('pipe.wbNone', { inst: code(s) }), ['stage:WB', `slot:${s.slot}`]);
            }
        }
    }

    function doMEM() {
        const p = S.stages.MEM;
        if (!p) return;
        for (const s of slotsOf(p)) {
            if (s.slot === 0) {
                if (!s.started) { s.started = true; s.done = true; }
                mark(s, 'MEM');
                continue;
            }
            const inst = instOf(s);
            const cls = inst.def.cls;
            if (!s.started) {
                s.started = true;
                s.done = false;
                let info = '';
                if (S.cache) {
                    const r = hierAccess(S.cache, cfg.memory, 'data', s.addr);
                    s.total = r.latency;
                    info = ' ' + describeAccess(r);
                } else {
                    s.total = 1;
                }
                s.remaining = s.total;
                const focus = ['stage:MEM', 'slot:1', `mem:${s.addr}`, ...(S.cache ? ['cache'] : [])];
                if (cls === 'load') step(t('pipe.memRead', { inst: code(s), addr: A(s.addr) }) + info, focus);
                else step(t('pipe.memWrite', { inst: code(s), addr: A(s.addr), value: V(s.b) }) + info, focus);
            }
            s.remaining--;
            mark(s, 'MEM');
            if (s.remaining > 0) {
                step(t('pipe.memBusy', { inst: code(s), done: s.total - s.remaining, total: s.total }), ['stage:MEM', 'slot:1']);
                continue;
            }
            s.done = true;
            if (cls === 'load') {
                s.result = memory.load(S.mem, s.addr, inst.def.mem, xlen);
                s.resultReady = true;
                step(t('pipe.memLoaded', { inst: code(s), value: V(s.result) }), ['stage:MEM', 'slot:1', `mem:${s.addr}`]);
            } else {
                S.mem = new Map(S.mem);
                memory.store(S.mem, s.addr, inst.def.mem, s.b);
            }
        }
    }

    function doEX() {
        const p = S.stages.EX;
        if (!p) return;
        for (const s of slotsOf(p)) {
            if (s.done) { mark(s, 'EX'); continue; }
            const inst = instOf(s);
            const d = inst.def;
            const preResolved = s.resolved && isControl(inst);
            if (!s.started && preResolved) {
                s.started = true;
                s.total = 1;
                s.remaining = 1;
                step(t('pipe.exResolved', { inst: code(s) }), ['stage:EX', `slot:${s.slot}`]);
            } else if (!s.started) {
                s.started = true;
                s.done = false;
                const before = S.forwards.length;
                s.a = operandForEx(inst.rs1, 'rs1', s);
                s.b = operandForEx(inst.rs2, 'rs2', s);
                s.c = operandForEx(inst.rs3, 'rs3', s);
                const fw = S.forwards.slice(before).map((f) => t('pipe.fwdItem', { reg: R(f.reg), from: f.from, value: V(f.value) }));
                s.total = s.slot === 1 ? 1 : cfg.latency[d.cls] ?? 1;
                s.remaining = s.total;
                const msg = s.slot === 1 ? t('dual.exStartMem', { inst: code(s) }) : t('pipe.exStart', { inst: code(s), lat: s.total });
                step(msg + (fw.length ? ' ' + t('pipe.fwdList', { list: fw.join('; ') }) : ''), ['stage:EX', `slot:${s.slot}`, ...(fw.length ? ['fwd'] : [])]);
            }
            s.remaining--;
            mark(s, 'EX');
            if (s.remaining > 0) {
                step(t('pipe.exBusy', { inst: code(s), done: s.total - s.remaining, total: s.total }), ['stage:EX', `slot:${s.slot}`]);
                continue;
            }
            s.done = true;
            if (s.slot === 1) {
                s.addr = effectiveAddress(inst, s.a, xlen);
                step(t('pipe.exAddr', { inst: code(s), addr: A(s.addr) }), ['stage:EX', 'slot:1']);
            } else if (isControl(inst)) {
                if (!s.resolved) {
                    s.resolved = true;
                    resolveBranch(s, s.a, s.b, 'EX');
                }
                if (s.result !== null) s.resultReady = true;
            } else if (d.cls !== 'system') {
                s.result = d.exec(s.a, s.b, inst, xlen, s.c);
                s.resultReady = true;
                step(t('pipe.exDone', { inst: code(s), value: V(s.result) }), ['stage:EX', 'slot:0']);
            }
        }
    }

    /** Dependência de dados de uma instrução em ID que impede o pacote de avançar para EX. */
    function idHazard(slot) {
        const inst = instOf(slot);
        if (branchInId && (inst.def.cls === 'branch' || inst.name === 'jalr'))
            return slot.resolved ? null : (slot.branchWait ?? { reg: null, producer: null });
        for (const reg of srcRegs(inst)) {
            const p = producer(reg);
            if (!p) continue;
            if (!fwd) {
                if (p.stage === 'EX' || p.stage === 'MEM') return { reg, producer: p.slot, stage: p.stage };
            } else if (p.stage !== 'WB' && !(p.slot.resultReady || (p.stage === 'EX' && p.slot.done && !isLoad(p.slot) && p.slot.result !== null))) {
                return { reg, producer: p.slot, stage: p.stage };
            }
        }
        return null;
    }

    function idBranchHazard(slot) {
        for (const reg of srcRegs(instOf(slot))) {
            const p = producer(reg);
            if (!p || p.stage === 'WB') continue;
            if (p.stage === 'EX') return { reg, producer: p.slot, stage: p.stage };
            if (!fwd || isLoad(p.slot)) return { reg, producer: p.slot, stage: p.stage };
        }
        return null;
    }

    function idOperand(reg) {
        if (reg === null) return null;
        if (reg === 'x0') return 0n;
        const p = producer(reg);
        if (p && p.stage === 'MEM' && fwd && p.slot.resultReady) {
            S.forwards.push({ to: 'ID', from: 'EX/MEM', reg, value: p.slot.result, fromSlot: p.slot.slot });
            stats.forwards++;
            return p.slot.result;
        }
        return readReg(S.regs, reg);
    }

    function doID() {
        const p = S.stages.ID;
        if (!p) return;
        const first = p.idCycles === 0;
        p.idCycles++;
        for (const s of slotsOf(p)) {
            const inst = instOf(s);
            const d = inst.def;
            mark(s, first ? 'ID' : 'Stall');
            if (first) step(t('pipe.decode', { inst: code(s) }), ['stage:ID', `slot:${s.slot}`]);
            if (d.cls === 'system' && !S.halted) {
                S.halted = true;
                flushPacket('IF', t('pipe.reasonHalt'));
                step(t('pipe.halt', { inst: code(s) }), ['stage:ID', 'pc']);
            }
            if (inst.name === 'jal' && !s.resolved) {
                s.resolved = true;
                s.result = d.exec(null, null, inst, xlen);
                s.resultReady = true;
                s.taken = true;
                s.next = inst.target;
                if (s.predictedNext !== inst.target) {
                    step(t('pipe.jalId', { inst: code(s), addr: A(inst.target) }), ['stage:ID', 'pc']);
                    flushPacket('IF', t('pipe.reasonJump'));
                    S.pc = inst.target;
                }
            }
            if (branchInId && (d.cls === 'branch' || inst.name === 'jalr') && !s.resolved) {
                const h = idBranchHazard(s);
                if (h) {
                    s.branchWait = h;
                } else {
                    s.branchWait = null;
                    s.resolved = true;
                    resolveBranch(s, idOperand(inst.rs1), idOperand(inst.rs2), 'ID');
                    if (s.result !== null) s.resultReady = true;
                }
            }
        }
    }

    function doIF() {
        const p = S.stages.IF;
        if (!p) return;
        if (p.ifRemaining > 0) {
            p.ifRemaining--;
            for (const s of slotsOf(p)) mark(s, 'IF');
            if (p.ifTotal > 1)
                step(t(p.ifRemaining > 0 ? 'pipe.ifBusy' : 'pipe.ifDone', { inst: slotsOf(p).map(code).join(' + '), done: p.ifTotal - p.ifRemaining, total: p.ifTotal }), ['stage:IF', 'cache']);
        } else {
            for (const s of slotsOf(p)) mark(s, 'Stall');
        }
    }

    // Busca de um pacote --------------------------------------------------------------------------------

    function newSlot(i, slot) {
        const inst = program.instructions[i];
        const d = {
            id: dyn.length, index: i, pc: inst.pc, text: inst.text, issue: S.cycle, commit: null,
            squashed: null, mispredicted: false, marks: [], slot,
        };
        dyn.push(d);
        return {
            dyn: d.id, index: i, slot, a: null, b: null, c: null, result: null, resultReady: false, addr: null,
            remaining: 0, total: 0, started: false, done: false, resolved: false, taken: null, next: null,
            predictedNext: null, predicted: null, branchWait: null, stalled: false,
        };
    }

    function fetchPacket() {
        const i = indexAt(program, S.pc);
        if (i < 0) return;
        const form = formPacket(program, i);
        const slots = [null, null];
        for (const k of form.members) {
            const inst = program.instructions[k];
            slots[slotOf(inst)] = newSlot(k, slotOf(inst));
        }
        const lastIdx = form.members[form.members.length - 1];
        const last = program.instructions[lastIdx];
        let predictedNext = last.pc + 4, predicted = null;
        const lastSlot = slots[slotOf(last)];
        if (last.def.cls === 'branch') {
            predicted = predict(last);
            if (predicted) predictedNext = last.target;
        }
        for (const s of slots.filter(Boolean)) s.predictedNext = s === lastSlot ? predictedNext : instOf(s).pc + 4;
        lastSlot.predicted = predicted;
        const p = { slots, reason: form.reason, idCycles: 0, stalled: false, ifTotal: 1, ifRemaining: 1 };
        S.stages.IF = p;
        S.pc = predictedNext;
        stats.packets++;
        if (form.members.length === 2) stats.dualPackets++;

        let info = '';
        if (S.cache && cfg.memory.levels.L1I.enabled) {
            let lat = 0;
            const descs = [];
            for (const s of slots.filter(Boolean)) {
                const r = hierAccess(S.cache, cfg.memory, 'inst', instOf(s).pc);
                lat = Math.max(lat, r.latency);
                descs.push(describeAccess(r));
            }
            p.ifTotal = lat;
            info = ' ' + descs.join(' ');
        }
        p.ifRemaining = p.ifTotal;
        const focus = ['stage:IF', 'pc', ...(info ? ['cache'] : [])];
        const pred = predicted ? ' ' + t('dual.predictedTaken', { next: A(predictedNext) }) : '';
        if (form.members.length === 2) {
            step(t('dual.fetchPair', { a: code(slots[0]), b: code(slots[1]), addr: A(program.instructions[form.members[0]].pc) }) + pred + info, focus);
        } else {
            const only = slots[0] ?? slots[1];
            const empty = slots[0] ? 1 : 0;
            const other = form.other !== undefined ? `\`${program.instructions[form.other].text}\`` : '';
            const why = t(`dual.why.${form.reason}`, { other, reg: form.reg ? R(form.reg) : '', inst: code(only) });
            step(t('dual.fetchAlone', { inst: code(only), addr: A(instOf(only).pc), slot: empty, why }) + pred + info, focus);
        }
    }

    // Avanço dos pacotes ----------------------------------------------------------------------------------

    function advance() {
        const st = S.stages;
        S.hazard = null;
        let idBlock = null;
        if (st.ID) for (const s of slotsOf(st.ID)) { idBlock = idHazard(s); if (idBlock) { idBlock.slot = s; break; } }
        st.WB = null;
        let memFree = true;
        if (st.MEM) {
            if (slotsOf(st.MEM).every((s) => s.done)) { st.WB = st.MEM; st.MEM = null; } else memFree = false;
        }
        let exFree = true;
        if (st.EX) {
            if (slotsOf(st.EX).every((s) => s.done) && memFree) {
                for (const s of slotsOf(st.EX)) s.started = false;
                st.MEM = st.EX;
                st.EX = null;
            } else {
                exFree = false;
            }
        }
        let idFree = true;
        if (st.ID) {
            const p = st.ID;
            if (exFree && !idBlock) {
                for (const s of slotsOf(p)) { s.started = false; s.stalled = false; }
                p.stalled = false;
                stats.emptySlots += 2 - slotsOf(p).length;
                st.EX = p;
                st.ID = null;
            } else {
                idFree = false;
                p.stalled = true;
                for (const s of slotsOf(p)) s.stalled = true;
                if (exFree && idBlock && idBlock.producer) {
                    stats.dataStalls++;
                    S.hazard = { kind: 'data', slot: idBlock.slot.dyn, reg: idBlock.reg, producer: idBlock.producer.dyn };
                    step(t('dual.stallData', { inst: code(idBlock.slot), reg: R(idBlock.reg), prod: code(idBlock.producer), stage: idBlock.stage }), ['stage:ID', 'hazard']);
                } else {
                    stats.structStalls++;
                    const s0 = slotsOf(p)[0];
                    S.hazard = { kind: 'busy', slot: s0.dyn };
                    step(t('dual.stallBusy', { inst: slotsOf(p).map(code).join(' + ') }), ['stage:ID', 'hazard']);
                }
            }
        }
        let ifFree = true;
        if (st.IF) {
            if (idFree && st.IF.ifRemaining === 0) {
                st.ID = st.IF;
                st.IF = null;
            } else {
                ifFree = false;
            }
        }
        if (ifFree && !S.halted) fetchPacket();
    }

    // Laço principal ----------------------------------------------------------------------------------------

    const inFlight = () => ['IF', 'ID', 'EX', 'MEM'].some((s) => S.stages[s] !== null);
    const isDone = () => !inFlight() && (S.halted || indexAt(program, S.pc) < 0);

    rec.endCycle();
    while (S.cycle === 0 || !isDone()) {
        if (S.cycle >= cfg.maxCycles) {
            warnings.push(t('common.maxCycles', { n: cfg.maxCycles }));
            break;
        }
        S.cycle++;
        S.forwards = [];
        rec.beginCycle();
        advance();
        doWB();
        doMEM();
        doEX();
        doID();
        doIF();
        rec.endCycle(t('common.endOfCycle'));
    }

    return {
        errors: [],
        model: 'dual',
        config: cfg,
        program,
        states: rec.states,
        interStates: rec.interStates,
        dyn,
        warnings,
        finished: isDone(),
        stats: {
            ...stats, cycles: S.cycle, ipc: S.cycle > 0 ? stats.instructions / S.cycle : 0,
            cpi: stats.instructions > 0 ? S.cycle / stats.instructions : 0,
            ...(S.cache ? { memory: hierarchyStats(S.cache) } : {}),
        },
        final: { x: S.regs.x, f: S.regs.f, mem: S.mem },
    };
}

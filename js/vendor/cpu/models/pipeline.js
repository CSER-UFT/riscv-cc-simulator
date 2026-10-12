/**
 * Pipeline clássico de 5 estágios (IF, ID, EX, MEM, WB) do RISC-V, como em Patterson e Hennessy.
 *
 * Execução em ordem, uma instrução por estágio. Opções:
 *   encaminhamento (forwarding) de EX/MEM e MEM/WB para a entrada da ALU, ou leitura apenas pelo banco
 *     de registradores (escrita na primeira metade do ciclo, leitura na segunda);
 *   resolução de desvios em EX (dois ciclos de penalidade) ou em ID (um ciclo, com mais dependências);
 *   previsão de desvios no IF (com o destino conhecido já na busca);
 *   latências de várias etapas no EX (sem pipeline: as instruções seguintes esperam) e cache de dados no MEM.
 *
 * As decisões de avanço são tomadas ao fim de cada ciclo, a partir do estado de todos os estágios.
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

export function simulatePipeline(program, userConfig = {}) {
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
        stages: { IF: null, ID: null, EX: null, MEM: null, WB: null },
        forwards: [],
        hazard: null,
    };
    const dyn = [];
    const stats = { instructions: 0, branches: 0, mispredicts: 0, dataStalls: 0, structStalls: 0, flushed: 0, forwards: 0 };
    const warnings = [];

    const rec = new Recorder(userConfig.trace !== false, () => ({
        cycle: S.cycle, pc: S.pc, halted: S.halted, regs: S.regs, cache: S.cache, bht: S.bht,
        stages: STAGES.map((s) => S.stages[s] && publicSlot(S.stages[s])),
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

    function publicSlot(s) {
        return {
            dyn: s.dyn, index: s.index, a: s.a, b: s.b, c: s.c, result: s.result, addr: s.addr,
            remaining: s.remaining, total: s.total, done: s.done, stalled: s.stalled, taken: s.taken, next: s.next,
            ifRemaining: s.ifRemaining, ifTotal: s.ifTotal,
            predicted: s.predicted, predictedNext: s.predictedNext,
        };
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
    const destOf = (slot) => {
        const r = instOf(slot).rd;
        return r && r !== 'x0' ? r : null;
    };
    const sources = (inst) => [inst.rs1, inst.rs2, inst.rs3].filter((r) => r && r !== 'x0');

    /** Produtor mais recente, em EX, MEM ou WB, de um registrador. */
    function producer(reg) {
        for (const st of ['EX', 'MEM', 'WB']) {
            const s = S.stages[st];
            if (s && destOf(s) === reg) return { slot: s, stage: st };
        }
        return null;
    }

    /** Valor de um operando no início do EX (com encaminhamento, se habilitado). */
    function operandForEx(reg, field, slot) {
        if (reg === null) return null;
        if (reg === 'x0') return 0n;
        if (fwd) {
            for (const [st, latch] of [['MEM', 'EX/MEM'], ['WB', 'MEM/WB']]) {
                const p = S.stages[st];
                if (p && destOf(p) === reg && p.resultReady) {
                    S.forwards.push({ to: field, from: latch, reg, value: p.result, dyn: slot.dyn });
                    stats.forwards++;
                    return p.result;
                }
            }
        }
        return readReg(S.regs, reg);
    }

    function flushSlot(stage, reason) {
        const s = S.stages[stage];
        if (!s) return;
        dyn[s.dyn].squashed = S.cycle;
        mark(s, 'Descartada');
        stats.flushed++;
        S.stages[stage] = null;
        step(t('pipe.flush', { inst: code(s), stage, reason }), [`stage:${stage}`]);
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
            if (stage === 'EX') flushSlot('ID', reason);
            flushSlot('IF', reason);
            S.pc = r.next;
            S.halted = false;
        } else if (inst.def.cls === 'branch') {
            step(t('pipe.branchOk', { inst: code(slot), stage, dir: taken(r.taken) }), [`stage:${stage}`]);
        }
    }

    // Trabalho de cada estágio no ciclo -------------------------------------------------------------------

    function doWB() {
        const s = S.stages.WB;
        if (!s) return;
        const inst = instOf(s);
        mark(s, 'WB');
        stats.instructions++;
        dyn[s.dyn].commit = S.cycle;
        const dest = destOf(s);
        if (dest && s.result !== null) {
            writeReg(S.regs, dest, s.result);
            step(t('pipe.wb', { inst: code(s), reg: R(dest), value: V(s.result) }), ['stage:WB', `reg:${dest}`]);
        } else if (inst.def.cls === 'system') {
            step(t('pipe.wbSystem', { inst: code(s) }), ['stage:WB']);
        } else {
            step(t('pipe.wbNone', { inst: code(s) }), ['stage:WB']);
        }
    }

    function doMEM() {
        const s = S.stages.MEM;
        if (!s) return;
        const inst = instOf(s);
        const cls = inst.def.cls;
        if (!s.started) {
            s.started = true;
            s.done = false;
            let info = '';
            if ((cls === 'load' || cls === 'store') && S.cache) {
                const r = hierAccess(S.cache, cfg.memory, 'data', s.addr);
                s.total = r.latency;
                info = ' ' + describeAccess(r);
            } else {
                s.total = 1;
            }
            s.remaining = s.total;
            if (cls === 'load') step(t('pipe.memRead', { inst: code(s), addr: A(s.addr) }) + info, ['stage:MEM', `mem:${s.addr}`, ...(S.cache ? ['cache'] : [])]);
            if (cls === 'store') step(t('pipe.memWrite', { inst: code(s), addr: A(s.addr), value: V(s.b) }) + info, ['stage:MEM', `mem:${s.addr}`, ...(S.cache ? ['cache'] : [])]);
        }
        s.remaining--;
        mark(s, 'MEM');
        if (s.remaining > 0) {
            step(t('pipe.memBusy', { inst: code(s), done: s.total - s.remaining, total: s.total }), ['stage:MEM']);
            return;
        }
        s.done = true;
        if (cls === 'load') {
            s.result = memory.load(S.mem, s.addr, inst.def.mem, xlen);
            s.resultReady = true;
            step(t('pipe.memLoaded', { inst: code(s), value: V(s.result) }), ['stage:MEM', `mem:${s.addr}`]);
        } else if (cls === 'store') {
            S.mem = new Map(S.mem);
            memory.store(S.mem, s.addr, inst.def.mem, s.b);
        }
    }

    function doEX() {
        const s = S.stages.EX;
        if (!s) return;
        const inst = instOf(s);
        const d = inst.def;
        const preResolved = s.resolved && (d.cls === 'branch' || d.cls === 'jump');
        if (!s.started && preResolved) {
            s.started = true;
            s.total = 1;
            s.remaining = 1;
            step(t('pipe.exResolved', { inst: code(s) }), ['stage:EX']);
        } else if (!s.started) {
            s.started = true;
            s.done = false;
            const before = S.forwards.length;
            s.a = operandForEx(inst.rs1, 'rs1', s);
            s.b = operandForEx(inst.rs2, 'rs2', s);
            s.c = operandForEx(inst.rs3, 'rs3', s);
            const fw = S.forwards.slice(before).map((f) => t('pipe.fwdItem', { reg: R(f.reg), from: f.from, value: V(f.value) }));
            s.total = d.cls === 'load' || d.cls === 'store' ? 1 : cfg.latency[d.cls] ?? 1;
            s.remaining = s.total;
            step(t('pipe.exStart', { inst: code(s), lat: s.total }) + (fw.length ? ' ' + t('pipe.fwdList', { list: fw.join('; ') }) : ''),
                ['stage:EX', ...(fw.length ? ['fwd'] : [])]);
        }
        s.remaining--;
        mark(s, 'EX');
        if (s.remaining > 0) {
            step(t('pipe.exBusy', { inst: code(s), done: s.total - s.remaining, total: s.total }), ['stage:EX']);
            return;
        }
        s.done = true;
        if (d.cls === 'load' || d.cls === 'store') {
            s.addr = effectiveAddress(inst, s.a, xlen);
            step(t('pipe.exAddr', { inst: code(s), addr: A(s.addr) }), ['stage:EX']);
        } else if (d.cls === 'branch' || d.cls === 'jump') {
            if (!s.resolved) {
                s.resolved = true;
                resolveBranch(s, s.a, s.b, 'EX');
            }
            if (s.result !== null) s.resultReady = true;
        } else if (d.cls !== 'system') {
            s.result = d.exec(s.a, s.b, inst, xlen, s.c);
            s.resultReady = true;
            step(t('pipe.exDone', { inst: code(s), value: V(s.result) }), ['stage:EX']);
        }
    }

    /** Verifica se a instrução em ID pode avançar para EX no próximo ciclo. */
    function idHazard(slot) {
        const inst = instOf(slot);
        for (const reg of sources(inst)) {
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

    /** Dependências de um desvio resolvido em ID: os operandos precisam estar disponíveis neste ciclo. */
    function idBranchHazard(slot) {
        const inst = instOf(slot);
        for (const reg of sources(inst)) {
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
            S.forwards.push({ to: 'ID', from: 'EX/MEM', reg, value: p.slot.result });
            stats.forwards++;
            return p.slot.result;
        }
        return readReg(S.regs, reg);
    }

    function doID() {
        const s = S.stages.ID;
        if (!s) return;
        const inst = instOf(s);
        const d = inst.def;
        mark(s, s.idCycles > 0 ? 'Stall' : 'ID');
        if (s.idCycles === 0) step(t('pipe.decode', { inst: code(s) }), ['stage:ID']);
        s.idCycles++;

        if (d.cls === 'system' && !S.halted) {
            S.halted = true;
            flushSlot('IF', t('pipe.reasonHalt'));
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
                flushSlot('IF', t('pipe.reasonJump'));
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

    function doIF() {
        const s = S.stages.IF;
        if (!s) return;
        if (s.ifRemaining > 0) {
            s.ifRemaining--;
            mark(s, 'IF');
            if (s.ifTotal > 1)
                step(t(s.ifRemaining > 0 ? 'pipe.ifBusy' : 'pipe.ifDone', { inst: code(s), done: s.ifTotal - s.ifRemaining, total: s.ifTotal }), ['stage:IF', 'cache']);
        } else {
            mark(s, 'Stall');
        }
    }

    // Avanço dos estágios (início de cada ciclo, a partir do estado ao fim do ciclo anterior) -----------

    function advance() {
        const st = S.stages;
        S.hazard = null;
        // Dependências de dados avaliadas com as posições do fim do ciclo anterior.
        let idBlock = null;
        if (st.ID) {
            const s = st.ID;
            const inst = instOf(s);
            if (branchInId && (inst.def.cls === 'branch' || inst.name === 'jalr'))
                idBlock = s.resolved ? null : (s.branchWait ?? { reg: null, producer: null });
            else
                idBlock = idHazard(s);
        }
        // WB: a instrução sai do pipeline
        st.WB = null;
        // MEM -> WB
        let memFree = true;
        if (st.MEM) {
            if (st.MEM.done) { st.WB = st.MEM; st.MEM = null; } else memFree = false;
        }
        // EX -> MEM
        let exFree = true;
        if (st.EX) {
            if (st.EX.done && memFree) {
                st.EX.started = false;
                st.MEM = st.EX;
                st.EX = null;
            } else {
                exFree = false;
            }
        }
        // ID -> EX
        let idFree = true;
        if (st.ID) {
            const s = st.ID;
            if (exFree && !idBlock) {
                s.started = false;
                s.stalled = false;
                st.EX = s;
                st.ID = null;
            } else {
                idFree = false;
                s.stalled = true;
                if (exFree && idBlock && idBlock.producer) {
                    stats.dataStalls++;
                    S.hazard = { kind: 'data', slot: s.dyn, reg: idBlock.reg, producer: idBlock.producer.dyn };
                    step(t('pipe.stallData', { inst: code(s), reg: R(idBlock.reg), prod: code(idBlock.producer), stage: idBlock.stage }), ['stage:ID', 'hazard']);
                } else {
                    stats.structStalls++;
                    S.hazard = { kind: 'busy', slot: s.dyn };
                    step(t('pipe.stallBusy', { inst: code(s) }), ['stage:ID', 'hazard']);
                }
            }
        }
        // IF -> ID
        let ifFree = true;
        if (st.IF) {
            if (idFree && st.IF.ifRemaining === 0) {
                st.ID = st.IF;
                st.IF = null;
            } else {
                ifFree = false;
            }
        }
        // Busca
        if (ifFree && !S.halted) {
            const i = indexAt(program, S.pc);
            if (i >= 0) {
                const inst = program.instructions[i];
                const d = {
                    id: dyn.length, index: i, pc: inst.pc, text: inst.text, issue: S.cycle, commit: null,
                    squashed: null, mispredicted: false, marks: [],
                };
                dyn.push(d);
                let predictedNext = inst.pc + 4;
                let predicted = null;
                if (inst.def.cls === 'branch') {
                    predicted = predict(inst);
                    if (predicted) predictedNext = inst.target;
                }
                st.IF = {
                    dyn: d.id, index: i, a: null, b: null, c: null, result: null, resultReady: false, addr: null,
                    remaining: 0, total: 0, started: false, done: false, resolved: false, taken: null, next: null,
                    predictedNext, predicted, idCycles: 0, ifCycles: 0, branchWait: null, stalled: false,
                };
                S.pc = predictedNext;
                let info = '';
                st.IF.ifTotal = 1;
                if (S.cache && cfg.memory.levels.L1I.enabled) {
                    const r = hierAccess(S.cache, cfg.memory, 'inst', inst.pc);
                    st.IF.ifTotal = r.latency;
                    info = ' ' + describeAccess(r);
                }
                st.IF.ifRemaining = st.IF.ifTotal;
                step(t(predicted ? 'pipe.fetchPredicted' : 'pipe.fetch', { inst: code(st.IF), addr: A(inst.pc), next: A(predictedNext) }) + info,
                    ['stage:IF', 'pc', ...(info ? ['cache'] : [])]);
            }
        }
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
        model: 'pipeline',
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

/**
 * Processador monociclo: cada instrução é executada inteiramente em um único ciclo de clock (CPI = 1).
 * Cada ciclo é mostrado em passos que seguem o caminho de dados: busca, decodificação e leitura de
 * registradores, execução na ALU, acesso à memória, escrita no banco de registradores e atualização do PC.
 */
import * as memory from '../riscv/memory.js';
import { initialState, readReg, writeReg, effectiveAddress, indexAt, resolveControl } from '../riscv/machine.js';
import { TEXT_BASE } from '../riscv/parser.js';
import * as fmt from '../riscv/format.js';
import { createHierarchy, access as hierAccess, hierarchyStats, accessParts } from '../riscv/hierarchy.js';
import { t } from '../i18n/index.js';
import { normalizeConfig } from '../core/config.js';
import { Recorder } from '../core/recorder.js';

const IMM_FORMATS = new Set(['I', 'SH', 'L', 'S', 'U', 'JR']);

/** Sinais de controle do caminho de dados monociclo para uma instrução. */
export function controlSignals(inst) {
    const d = inst.def;
    return {
        RegWrite: inst.rd !== null ? 1 : 0,
        ALUSrc: IMM_FORMATS.has(d.fmt) ? 1 : 0,
        MemRead: d.cls === 'load' ? 1 : 0,
        MemWrite: d.cls === 'store' ? 1 : 0,
        MemtoReg: d.cls === 'load' ? 1 : 0,
        Branch: d.cls === 'branch' ? 1 : 0,
        Jump: d.cls === 'jump' ? 1 : 0,
    };
}

export function simulateSingle(program, userConfig = {}) {
    const { config: cfg, errors } = normalizeConfig({ ...userConfig, xlen: program.xlen });
    if (errors.length > 0) return { errors };
    const xlen = program.xlen;
    const arch = initialState(program, { exampleValues: cfg.exampleValues });

    const S = { cycle: 0, pc: TEXT_BASE, halted: false, regs: { x: arch.x, f: arch.f }, mem: arch.mem, cur: null, phase: null, cache: createHierarchy(cfg.memory, program) };
    const dyn = [];
    const warnings = [];
    const stats = { instructions: 0, branches: 0, takenBranches: 0, loads: 0, stores: 0 };

    const rec = new Recorder(userConfig.trace !== false, () => ({
        cycle: S.cycle, pc: S.pc, halted: S.halted, regs: S.regs, cur: S.cur, phase: S.phase, cache: S.cache,
    }), () => S.mem);

    // No monociclo a hierarquia de memória não altera o tempo (CPI = 1): só registra acertos e falhas.
    const memNote = (kind, addr) => {
        if (!S.cache || (kind === 'inst' && !cfg.memory.levels.L1I.enabled)) return '';
        const r = hierAccess(S.cache, cfg.memory, kind, addr);
        return ' ' + t('mem.pathNoTime', { path: accessParts(r).join(', ') });
    };
    const step = (phase, msg, focus = []) => {
        S.phase = phase;
        rec.step(msg, focus);
    };
    const V = (x) => `//${fmt.value(x)}//`;
    const A = (x) => `//${fmt.address(x)}//`;
    const R = (r) => `**${r}**`;

    rec.endCycle();
    while (!S.halted && indexAt(program, S.pc) >= 0) {
        if (S.cycle >= cfg.maxCycles) {
            warnings.push(t('common.maxCycles', { n: cfg.maxCycles }));
            break;
        }
        S.cycle++;
        rec.beginCycle();
        const index = indexAt(program, S.pc);
        const inst = program.instructions[index];
        const d = inst.def;
        const code = `\`${inst.text}\``;
        const dd = { id: dyn.length, index, pc: inst.pc, text: inst.text, issue: S.cycle, commit: S.cycle, squashed: null, mispredicted: false, marks: [] };
        dyn.push(dd);
        rec.mark(dd, S.cycle, 'Exec');
        stats.instructions++;

        const cur = {
            index, pc: inst.pc, signals: controlSignals(inst), a: null, b: null, c: null, imm: inst.imm,
            result: null, addr: null, memValue: null, dest: inst.rd, wb: null, next: inst.pc + 4, taken: null,
        };
        S.cur = cur;
        step('IF', t('single.fetch', { addr: A(inst.pc), inst: code }) + memNote('inst', inst.pc), ['pc', 'imem']);

        cur.a = readReg(S.regs, inst.rs1);
        cur.b = readReg(S.regs, inst.rs2);
        cur.c = readReg(S.regs, inst.rs3);
        const reads = [[inst.rs1, cur.a], [inst.rs2, cur.b], [inst.rs3, cur.c]].filter(([r]) => r).map(([r, v]) => `${R(r)} = ${V(v)}`);
        step('ID', t('single.decode', { inst: code, reads: reads.length ? reads.join(', ') : t('single.noReads') }), ['regs', 'control']);

        let next = inst.pc + 4;
        if (d.cls === 'system') {
            S.halted = true;
            step('EX', t('single.system', { inst: code }), []);
        } else if (d.cls === 'load' || d.cls === 'store') {
            cur.addr = effectiveAddress(inst, cur.a, xlen);
            step('EX', t('single.address', { base: V(cur.a), off: inst.imm, addr: A(cur.addr) }), ['alu']);
            if (d.cls === 'load') {
                stats.loads++;
                cur.memValue = memory.load(S.mem, cur.addr, d.mem, xlen);
                cur.result = cur.memValue;
                step('MEM', t('single.load', { addr: A(cur.addr), value: V(cur.memValue) }) + memNote('data', cur.addr), ['dmem', `mem:${cur.addr}`]);
            } else {
                stats.stores++;
                S.mem = new Map(S.mem);
                memory.store(S.mem, cur.addr, d.mem, cur.b);
                step('MEM', t('single.store', { addr: A(cur.addr), value: V(cur.b) }) + memNote('data', cur.addr), ['dmem', `mem:${cur.addr}`]);
            }
        } else if (d.cls === 'branch' || d.cls === 'jump') {
            const r = resolveControl(inst, cur.a, cur.b, xlen);
            cur.taken = r.taken;
            cur.result = r.value;
            next = r.next;
            if (d.cls === 'branch') {
                stats.branches++;
                if (r.taken) stats.takenBranches++;
                step('EX', t('single.branch', { a: V(cur.a), b: V(cur.b), dir: t(r.taken ? 'common.taken' : 'common.notTaken'), addr: A(r.next) }), ['alu']);
            } else {
                step('EX', t('single.jump', { addr: A(r.next), value: V(r.value) }), ['alu']);
            }
        } else {
            cur.result = d.exec(cur.a, cur.b, inst, xlen, cur.c);
            step('EX', t('single.alu', { result: V(cur.result) }), ['alu']);
        }

        if (inst.rd !== null && cur.result !== null) {
            cur.wb = cur.result;
            writeReg(S.regs, inst.rd, cur.result);
            step('WB', inst.rd === 'x0' ? t('single.wbZero') : t('single.wb', { reg: R(inst.rd), value: V(cur.result) }), ['regs', `reg:${inst.rd}`]);
        }
        cur.next = next;
        S.pc = next;
        if (!S.halted) step('PC', t('single.pc', { addr: A(next) }), ['pc']);
        rec.endCycle(t('common.endOfCycle'));
    }

    return {
        errors: [],
        model: 'single',
        config: cfg,
        program,
        states: rec.states,
        interStates: rec.interStates,
        dyn,
        warnings,
        finished: S.halted || indexAt(program, S.pc) < 0,
        stats: {
            ...stats, cycles: S.cycle, ipc: S.cycle > 0 ? stats.instructions / S.cycle : 0, cpi: 1,
            ...(S.cache ? { memory: hierarchyStats(S.cache) } : {}),
        },
        final: { x: S.regs.x, f: S.regs.f, mem: S.mem },
    };
}

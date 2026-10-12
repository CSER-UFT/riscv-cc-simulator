/**
 * Registro de passos e ciclos de uma simulação, comum a todos os modelos de processador.
 *
 * Cada passo guarda uma mensagem e um instantâneo do estado. Para economizar memória, os instantâneos
 * compartilham as partes que não mudaram desde o instantâneo anterior (compartilhamento estrutural):
 * cada componente é comparado pelo seu conteúdo serializado e, se for igual, o mesmo objeto é reaproveitado.
 * A memória é tratada como imutável pelos motores (copiada a cada escrita) e por isso é sempre compartilhada.
 */

function replacer(key, v) {
    if (typeof v === 'bigint') return `${v}n`;
    if (typeof v === 'number') {
        if (Number.isNaN(v)) return 'NaN';
        if (v === Infinity) return 'Inf';
        if (v === -Infinity) return '-Inf';
        if (Object.is(v, -0)) return '-0';
    }
    return v;
}

export class Recorder {

    /**
     * @param {boolean} trace guardar instantâneos (desligado nos testes, por desempenho)
     * @param {() => object} getState retorna os componentes do estado atual
     * @param {() => Map} getMem retorna a memória atual
     */
    constructor(trace, getState, getMem) {
        this.trace = trace;
        this.getState = getState;
        this.getMem = getMem;
        this.states = [];
        this.interStates = [];
        this.steps = [];
        this.seq = 0;
        this.pending = [];
        this.shared = new Map();
    }

    share(id, value) {
        if (value === null || typeof value !== 'object') return value;
        const key = JSON.stringify(value, replacer);
        const prev = this.shared.get(id);
        if (prev && prev.key === key) return prev.obj;
        const obj = structuredClone(value);
        this.shared.set(id, { key, obj });
        return obj;
    }

    snapshot(focus) {
        const state = this.getState();
        const snap = { seq: this.seq, focus, mem: this.getMem() };
        for (const [k, v] of Object.entries(state)) {
            if (Array.isArray(v) && v.some((x) => typeof x === 'object' && x !== null)) {
                snap[k] = v.map((item, i) => this.share(`${k}.${item?.name ?? i}`, item));
            } else if (k === 'rob' && v) {
                snap[k] = { head: v.head, count: v.count, entries: v.entries.map((e, i) => this.share(`rob.${i}`, e)) };
            } else if (k === 'regs') {
                snap[k] = { x: this.share('regs.x', v.x), f: this.share('regs.f', v.f) };
            } else {
                snap[k] = this.share(k, v);
            }
        }
        return snap;
    }

    /** Registra um passo explicativo. */
    step(msg, focus = []) {
        this.seq++;
        for (const m of this.pending) m[2] = this.seq;
        this.pending = [];
        if (this.trace) this.steps.push([msg, this.snapshot(focus)]);
    }

    /** Registra um rótulo na linha do tempo de uma instrução dinâmica; ele passa a valer no próximo passo. */
    mark(d, cycle, label) {
        const m = [cycle, label, null];
        d.marks.push(m);
        this.pending.push(m);
    }

    beginCycle() {
        this.steps = [];
    }

    /** Fecha o ciclo atual, guardando o estado final e os passos intermediários. */
    endCycle(closingMessage = '') {
        if (this.pending.length > 0) this.step(closingMessage);
        this.states.push(this.trace ? this.snapshot([]) : null);
        this.interStates.push(this.steps);
        this.steps = [];
    }
}

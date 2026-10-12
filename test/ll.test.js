import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { both } from './helpers.js';
import { compile, compileLL } from '../js/cc/compile.js';
import { interpret } from '../js/cc/irinterp.js';
import { EXAMPLES } from '../js/examples.js';
import { EXAMPLES_LL } from '../js/examples-ll.js';

// Saídas reais do clang 18: clang --target=riscv32 -march=rv32imf -mabi=ilp32f -O0 -S -emit-llvm exemplo.c
const DIR = new URL('./ll/', import.meta.url);
const files = readdirSync(DIR).filter((f) => f.endsWith('.ll'));

test('importa a IR do clang -O0 de todos os exemplos com o mesmo resultado do MiniC', () => {
    assert.equal(files.length, EXAMPLES.length);
    for (const f of files) {
        const id = f.replace('.ll', '');
        const ex = EXAMPLES.find((e) => e.id === id);
        const src = readFileSync(new URL(f, DIR), 'utf8');
        const r = both(src, {}, compileLL);
        const mini = interpret(compile(ex.code).module);
        assert.equal(r.asm.reason, 'end', id);
        assert.ok(Object.is(r.ir.ret, mini.ret), `${id}: ${r.ir.ret} != ${mini.ret}`);
        for (const x of [r.asm, r.ssaAsm, r.optAsm]) assert.ok(Object.is(x.ret, mini.ret), id);
        for (const [g, v] of mini.globals) assert.deepEqual(r.asm.globals.get(g), v, `${id} @${g}`);
        // O exemplo da interface (o mesmo .ll sem atributos e metadados) dá o mesmo programa.
        const ui = compileLL(EXAMPLES_LL[id]);
        assert.equal(ui.errors.length, 0, id);
        assert.equal(ui.ir.text, compileLL(src).ir.text, id);
    }
});

test('a IR importada mantém a numeração do clang e as linhas do .ll', () => {
    const src = readFileSync(new URL('saxpy.ll', DIR), 'utf8');
    const r = compileLL(src);
    assert.match(r.ir.text, /define void @saxpy\(i32 %0, float %1, ptr %2, ptr %3\)/);
    assert.match(r.ir.text, /%24\.mul = fmul float %15, %19\n {2}%24 = fadd float %24\.mul, %23/);
    const lines = src.split('\n');
    const store = r.module.functions[0].blocks.at(-2).insts.find((i) => i.op === 'store');
    assert.match(lines[store.line - 1], /store i32 %30/);
    // A mem2reg promove as variáveis: sobram só os acessos aos vetores.
    assert.ok(r.ssa.module.functions.every((F) => F.allocas.length === 0));
});

test('aceita IR escrita à mão, já em SSA, com phi', () => {
    const src = `
define i32 @soma(i32 %n) {
entry:
  br label %laco
laco:
  %i = phi i32 [ 0, %entry ], [ %i1, %laco ]
  %s = phi i32 [ 0, %entry ], [ %s1, %laco ]
  %s1 = add i32 %s, %i
  %i1 = add i32 %i, 1
  %c = icmp slt i32 %i1, %n
  br i1 %c, label %laco, label %fim
fim:
  ret i32 %s1
}
define i32 @main() {
  %r = call i32 @soma(i32 10)
  ret i32 %r
}`;
    const r = both(src, {}, compileLL);
    assert.equal(r.ir.ret, 45);
    assert.equal(r.asm.ret, 45);
});

test('vetores locais iniciados com memcpy e memset (clang -O0)', () => {
    const src = readFileSync(new URL('./ll-local.txt', import.meta.url), 'utf8');
    const r = both(src, {}, compileLL);
    assert.equal(r.ir.ret, 16);
    assert.equal(r.asm.ret, 16);
    assert.ok(!/memcpy|memset/.test(r.ir.text));
});

test('recusa o que está fora do subconjunto, com a linha', () => {
    const cases = [
        ['define i32 @main() {\n  %1 = alloca double, align 8\n  ret i32 0\n}', 2, 'll.type'],
        ['define i32 @main() {\n  %1 = select i1 true, i32 1, i32 2\n  ret i32 %1\n}', 2, 'll.op'],
        ['define i32 @main() {\n  %1 = add i64 1, 2\n  ret i32 0\n}', 2, 'll.type'],
        ['define i32 @main() {\n  %1 = call i32 @llvm.smax.i32(i32 1, i32 2)\n  ret i32 %1\n}', 2, 'll.intrinsic'],
        ['define i32 @main() {\n  %1 = alloca [2 x i32]\n  call void @llvm.memset.p0.i32(ptr %1, i8 0, i32 6, i1 false)\n  ret i32 0\n}', 3, 'll.intrinsic'],
        ['define i32 @main() {\n  %1 = call i32 @f()\n  ret i32 %1\n}', 2, 'll.undefFn'],
        ['define i32 @main() {\n  ret i32 %7\n}', 2, 'll.undefValue'],
        ['define i32 @main() {\n  br label %9\n}', 2, 'll.noLabel'],
        ['define i32 @f() {\n  ret i32 0\n}', 1, 'll.noMain'],
    ];
    for (const [src, line, key] of cases) {
        const r = compileLL(src);
        assert.equal(r.errors.length, 1, src);
        assert.equal(r.errors[0].key, key, src);
        assert.equal(r.errors[0].line, line, src);
    }
});

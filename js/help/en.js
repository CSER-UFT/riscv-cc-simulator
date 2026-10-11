/**
 * Simulator help, in English. Each section becomes an entry of the table of contents.
 */
export default {
    title: 'RISC-V Compiler Simulator',
    lead: 'Educational compiler simulator: a program in MiniC, a subset of C with pointers, goes through lexical, syntax and semantic analysis, becomes an intermediate representation in LLVM format and, finally, RISC-V assembly, which runs right here or opens in the Processor Simulator. Everything runs in the browser, with no installation.',
    searchPlaceholder: 'Search the help',
    noResults: 'No section contains this term.',
    tocTitle: 'Contents',
    close: 'Close help',
    sections: [
        {
            id: 'start',
            title: 'Getting started',
            html: `
<ol>
    <li>Choose an <strong>example</strong> or write your program in the editor. The code is compiled as you type; errors appear below the editor with their line number (click an error to go to it).</li>
    <li>Follow the <strong>phases</strong> in the strip above the tabs: each finished phase gets a ✓; the phase with an error is marked with ✗ and the following ones wait.</li>
    <li>Explore the tabs: <strong>Tokens</strong> and <strong>Tree</strong> have a step by step view (keyboard arrows or <strong>Animate</strong>); <strong>Symbols</strong> shows the symbol table; <strong>IR and RISC-V</strong> shows the generated code side by side; <strong>Stack</strong> draws the activation record of each function.</li>
    <li>The result of the run (return value of <code>main</code>, executed instructions and global variables) appears in the <strong>Execution</strong> panel.</li>
    <li>To watch the same code going through the pipeline, use <strong>Open in the processor simulator</strong>.</li>
</ol>
<p class="tip">Suggestion to start: the <em>Array sum</em> example in the IR and RISC-V tab. Click the line <code>s = s + v[i];</code> in the editor and see which IR and assembly instructions it generated.</p>`,
        },
        {
            id: 'screen',
            title: 'The screen',
            html: `
<dl>
    <dt>MiniC code</dt><dd>Editor with syntax highlighting. <kbd>Ctrl</kbd> + <kbd>Enter</kbd> compiles and runs again; <kbd>Tab</kbd> inserts four spaces. The text is kept in the browser for the next visit.</dd>
    <dt>Options</dt><dd><strong>IR comments</strong> places, next to each piece of assembly, the IR instruction that generated it; <strong>Source code lines</strong> interleaves the program lines as comments.</dd>
    <dt>Execution</dt><dd>The assembly is assembled and run by the same functional simulator as the Processor Simulator. The IR is also interpreted, and both results must match (the panel warns if they do not). The limit is two million instructions.</dd>
    <dt>Phases</dt><dd>Click a phase to open the matching tab.</dd>
    <dt>Linked views</dt><dd>A line clicked in the editor, in the IR or in the assembly is highlighted together with the matching lines in the other two views.</dd>
</dl>`,
        },
        {
            id: 'minic',
            title: 'The MiniC language',
            html: `
<p>MiniC is a subset of C designed to fit in a compilers or computer organization class.</p>
<h3>What it has</h3>
<ul>
    <li>32 bit <code>int</code> and <code>float</code> types, <code>void</code> for functions, <code>int *</code> and <code>float *</code> pointers and one dimensional arrays (<code>int v[10]</code>), global or local.</li>
    <li>Global variables with a constant initial value, including lists: <code>int v[3] = {1, 2, 3};</code>. Local variables with any expression as initial value.</li>
    <li>Functions with up to 8 parameters, recursion and prototypes (<code>int f(int x);</code>). Arrays are passed as pointers: <code>int sum(int v[], int n)</code> is the same as <code>int sum(int *v, int n)</code>.</li>
    <li>Statements <code>if</code>, <code>else</code>, <code>while</code>, <code>for</code> (with a declaration at the start), <code>return</code>, <code>break</code>, <code>continue</code> and blocks with their own scope.</li>
    <li>Arithmetic, comparison, short circuit logical (<code>&amp;&amp;</code>, <code>||</code>, <code>!</code>) and bitwise operators (<code>&amp; | ^ ~ &lt;&lt; &gt;&gt;</code>), compound assignments (<code>+=</code> and the like), prefix and postfix increment and decrement.</li>
    <li>Pointers: <code>&amp;x</code>, <code>&amp;v[i]</code>, <code>*p</code>, <code>p[i]</code>, <code>p + i</code>, <code>p - q</code> (number of elements), pointer comparisons and <code>p++</code>.</li>
    <li>Implicit conversions between <code>int</code> and <code>float</code>, as in C (conversion to <code>int</code> truncates).</li>
    <li><code>main</code> has no parameters and returns <code>int</code> (result in <code>a0</code>) or <code>float</code> (in <code>fa0</code>).</li>
</ul>
<h3>What is left out</h3>
<p>Explicit casts, <code>struct</code>, pointers to pointers, function pointers, dynamic allocation, <code>char</code> and strings, multidimensional arrays (use <code>A[i * n + j]</code>), <code>switch</code>, <code>do while</code> and the ternary operator.</p>
<h3>Grammar</h3>
<pre><code>program    = { declaration | function }
type       = ("int" | "float" | "void") ["*"]
declaration= type declarator { "," ["*"] declarator } ";"
declarator = ident ["[" integer "]"] ["=" (expr | "{" expr {"," expr} "}")]
function   = type ident "(" [param {"," param}] ")" (block | ";")
param      = type ident ["[" "]"]
block      = "{" { declaration | statement } "}"
statement  = block | if | while | for | "return" [expr] ";"
           | "break" ";" | "continue" ";" | [expr] ";"</code></pre>
<p>Expressions follow C precedence, from lowest to highest: assignment, <code>||</code>, <code>&amp;&amp;</code>, <code>|</code>, <code>^</code>, <code>&amp;</code>, equality, relational, shifts, sum, product, unary and postfix (index, call, <code>++</code> and <code>--</code>).</p>`,
        },
        {
            id: 'lex',
            title: 'Lexical analysis',
            html: `
<p>Lexical analysis turns the character sequence into a sequence of <strong>tokens</strong>: keywords, identifiers, integer and float constants, operators and punctuation. Spaces and comments are discarded here and never reach the next phases.</p>
<p>The recognizer is a hand written finite automaton: the first character chooses the state (letter: identifier; digit: number; symbol: operator) and the loop consumes characters while the state accepts them. The <strong>longest lexeme</strong> always wins: <code>&lt;=</code> is a single token, not <code>&lt;</code> followed by <code>=</code>; <code>x++</code> is <code>x</code> followed by <code>++</code>. A word recognized as an identifier becomes a keyword if it is in the list (<code>int</code>, <code>if</code>, <code>while</code>...).</p>
<p>In the <strong>Tokens</strong> tab, the step by step view highlights the text of each token in the editor. The <em>Value</em> column shows the converted number (float constants are rounded to 32 bits).</p>
<p>Errors of this phase: unknown character (like <code>@</code> or <code>"</code>), malformed number (<code>12abc</code>), integer larger than 32 bits and a <code>/*</code> comment without end.</p>`,
        },
        {
            id: 'parse',
            title: 'Syntax analysis',
            html: `
<p>Syntax analysis checks whether the token sequence follows the grammar and builds the <strong>abstract syntax tree</strong> (AST). The method is <strong>recursive descent</strong>: each grammar rule is a function, and so is each operator precedence level. So, in <code>a + b * c</code>, the sum level function calls the product level one, which consumes the whole <code>b * c</code> before the sum is built.</p>
<p>The tree is <em>abstract</em> because it keeps only what matters for the meaning: parentheses, commas and semicolons do not become nodes. The step by step view of the <strong>Tree</strong> tab shows the nodes in the order they are created. A function, a block or a <code>for</code> is created right at the start, and the statements join it one by one; an expression, instead, is only created after its parts: in <code>s + v[i]</code>, <code>s</code>, <code>v</code> and <code>i</code> appear, then <code>[ ]</code> and finally <code>+</code>, exactly in the order the recursive calls return. Use <strong>Show</strong> to see one function at a time.</p>
<p>The analysis stops at the first error, with the line, the column and the token found (for example, <em>expected ";", found "}"</em>).</p>`,
        },
        {
            id: 'sema',
            title: 'Semantic analysis',
            html: `
<p>Semantic analysis walks the tree and checks what the grammar cannot express: declared names, compatible types, number of arguments, <code>break</code> outside a loop and so on. It produces the <strong>symbol table</strong> and annotates each expression with its type (the small text below the nodes in the Tree tab).</p>
<h3>Scopes</h3>
<p>The global scope holds global variables and functions; each function opens a scope for its parameters, and each <code>{ }</code> block (and each <code>for</code>) opens a new scope. A name is looked up from the innermost scope to the outermost, so a local variable can hide a global one with the same name. Declaring the same name twice in the same scope is an error.</p>
<h3>Types and conversions</h3>
<ul>
    <li>In an operation between <code>int</code> and <code>float</code>, the <code>int</code> is converted to <code>float</code>. In an assignment, the value is converted to the variable type.</li>
    <li>An array used in an expression becomes a pointer to its first element (<em>decay</em>): <code>v</code> means <code>&amp;v[0]</code>.</li>
    <li><code>p + i</code> moves <code>i</code> elements forward (4 bytes each), and <code>p - q</code> gives the number of elements between both pointers.</li>
    <li>Assigning a pointer of one type to another (<code>float *</code> receiving <code>int *</code>) is an error, because MiniC has no explicit conversion.</li>
</ul>
<p>The symbol table shows, for each name, its category, type, scope, declaration line, number of uses and where the generated code keeps it. Local variables never used produce a warning.</p>`,
        },
        {
            id: 'ir',
            title: 'The intermediate representation',
            html: `
<p>The IR follows the LLVM textual format, as produced by <code>clang -O0</code>: what is learned here applies to reading the output of a real compiler and to research projects built on LLVM.</p>
<ul>
    <li>The module has the global variables (<code>@v = global [5 x i32] [...]</code>) and the functions (<code>define i32 @sum(ptr %p, i32 %n)</code>).</li>
    <li>Each function is a set of <strong>basic blocks</strong>: instruction sequences with no branches in the middle, ending with <code>br</code> or <code>ret</code>. The <code>; preds =</code> comment lists the blocks that branch to each block: this is the control flow graph.</li>
    <li>The values <code>%0</code>, <code>%1</code>... are assigned only once (SSA form). Program variables, which change value, live in memory: each gets an <code>alloca</code> in the <code>entry</code> block and is read with <code>load</code> and written with <code>store</code>. Parameters are copied to memory right at the entry.</li>
    <li><code>getelementptr inbounds i32, ptr %p, i32 %i</code> computes the address of element <code>i</code>: <code>p + 4 * i</code>.</li>
    <li><code>icmp slt</code> compares signed integers; <code>fcmp olt</code> compares floats. The result is an <code>i1</code>, converted to <code>i32</code> with <code>zext</code> when used as a number.</li>
    <li><code>&amp;&amp;</code> and <code>||</code> create blocks (<code>land.rhs</code>, <code>land.end</code>) and a <code>phi</code> function, which picks the value according to the block the control came from.</li>
    <li>The <code>nsw</code> (no signed wrap) and <code>exact</code> flags are the same clang emits.</li>
</ul>
<p>Differences from clang, to keep the text short: no <code>align 4</code> nor attributes, and a <code>return</code> in the middle of a function becomes a direct <code>ret</code>, without the <code>%retval</code> variable.</p>
<p>To compare with clang: <code>clang --target=riscv32 -march=rv32imf -mabi=ilp32f -O0 -S -emit-llvm prog.c</code> (the IR) and the same without <code>-emit-llvm</code> (the assembly).</p>`,
        },
        {
            id: 'codegen',
            title: 'RISC-V code generation',
            html: `
<p>The assembly uses the I, M and F extensions of RV32 and the RISC-V calling convention (ilp32f ABI), as in the Patterson and Hennessy book:</p>
<table>
    <tr><th>Registers</th><th>Use in the generated code</th></tr>
    <tr><td><code>a0</code> to <code>a7</code></td><td>integer and pointer arguments; <code>a0</code> also carries the result</td></tr>
    <tr><td><code>fa0</code> to <code>fa7</code></td><td>float arguments; <code>fa0</code> also carries the result</td></tr>
    <tr><td><code>t0</code> to <code>t5</code>, <code>ft0</code> to <code>ft7</code></td><td>IR temporary values, caller saved</td></tr>
    <tr><td><code>t6</code></td><td>auxiliary addresses (float constants, large offsets)</td></tr>
    <tr><td><code>s0</code></td><td>frame pointer (top of the activation record)</td></tr>
    <tr><td><code>sp</code>, <code>ra</code></td><td>stack top and return address</td></tr>
</table>
<h3>Instruction selection</h3>
<p>Each IR instruction becomes one or a few RISC-V instructions: <code>load</code> and <code>store</code> become <code>lw</code>, <code>sw</code>, <code>flw</code> and <code>fsw</code> with an offset from <code>s0</code>; <code>add</code> with a small constant becomes <code>addi</code>; <code>getelementptr</code> becomes <code>slli</code> (multiplies the index by 4) and <code>add</code>; <code>sitofp</code> becomes <code>fcvt.s.w</code>; <code>fptosi</code> becomes <code>fcvt.w.s</code> rounding toward zero (<code>rtz</code>), as C requires.</p>
<p>An integer comparison followed by the branch that uses it becomes a single conditional branch, as in the book: <code>for (i = 0; i &lt; n; i++)</code> generates <code>bge t0, t1, for.end</code>, with the condition inverted so that the loop body comes right after. A branch to the next block generates no instruction.</p>
<h3>Registers and saved values</h3>
<p>Temporaries used in the same block live in <code>t</code> and <code>ft</code> registers, picked in order and freed at their last use. A value that must survive a branch (such as the result of a <code>phi</code>) or a function call (the <code>t</code> registers are not preserved) is saved in a frame slot. The <code>phi</code> becomes copies to that slot at the end of each predecessor block.</p>
<h3>Program start</h3>
<p>The first two instructions call <code>main</code> (<code>jal ra, main</code>) and end the run (<code>ecall</code>), with the result in <code>a0</code> or <code>fa0</code>. Globals and float constants (<code>.LC0</code>...) are in the <code>.data</code> section.</p>`,
        },
        {
            id: 'frame',
            title: 'Activation record',
            html: `
<p>Each function call reserves an <strong>activation record</strong> (frame) on the stack. The prologue does:</p>
<pre><code>addi sp, sp, -32     # allocates the frame
sw   ra, 28(sp)      # saves the return address
sw   s0, 24(sp)      # saves the caller s0
addi s0, sp, 32      # s0 points to the top of the frame</code></pre>
<p>Below <code>s0</code> are <code>ra</code>, the previous <code>s0</code>, the parameters copied from the registers, the local variables (each IR <code>alloca</code> becomes a fixed slot) and the saved values. The epilogue restores <code>ra</code> and <code>s0</code>, frees the frame and returns with <code>ret</code>. The size is rounded up to a multiple of 16 bytes, as the ABI requires.</p>
<p>The <strong>Stack</strong> tab draws the frame of each function, with the offset of each slot from <code>s0</code> (what appears in the assembly) and from <code>sp</code>. In the <em>Recursive factorial</em> example, each call pushes one such frame.</p>`,
        },
        {
            id: 'cpu',
            title: 'Execution and the processor simulator',
            html: `
<p>The <strong>Execution</strong> panel shows the return value of <code>main</code>, how many RISC-V and IR instructions were executed, the size of the generated code and the final value of the global variables. The ratio between executed instructions and IR instructions shows the cost of compiling without optimization.</p>
<p><strong>Open in the processor simulator</strong> opens, in a new tab, the RISC-V Processor Simulator with the generated assembly, in the pipelined model. There you can see hazards, forwarding, bubbles and the effect of the copies to and from the stack on the execution time.</p>`,
        },
        {
            id: 'export',
            title: 'Exports',
            html: `
<ul>
    <li><strong>Export figure (SVG)</strong>: the tree (at the current step) and the activation record, with the light theme colors, ready for slides and papers.</li>
    <li><strong>LaTeX table</strong>: tokens, symbol table and stack frame, with the header in the <code>tabAzul</code> color and <code>\\hline</code> rows. Requires <code>\\usepackage[table]{xcolor}</code>.</li>
    <li><strong>Download IR (.ll)</strong> and <strong>Download assembly (.s)</strong>: the generated text, to compare with other tools.</li>
</ul>`,
        },
        {
            id: 'keys',
            title: 'Keyboard shortcuts',
            html: `
<table>
    <tr><th>Key</th><th>Action</th></tr>
    <tr><td><kbd>Ctrl</kbd> + <kbd>Enter</kbd></td><td>compiles and runs (in the editor)</td></tr>
    <tr><td><kbd>→</kbd> and <kbd>←</kbd></td><td>next and previous step (Tokens and Tree tabs)</td></tr>
    <tr><td><kbd>Home</kbd> and <kbd>End</kbd></td><td>start and end of the step by step view</td></tr>
    <tr><td><kbd>Space</kbd></td><td>animates or pauses</td></tr>
    <tr><td><kbd>Esc</kbd></td><td>closes the help</td></tr>
</table>`,
        },
    ],
};

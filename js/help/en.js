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
    <li>Explore the tabs: <strong>Tokens</strong> and <strong>Tree</strong> have a step by step view (keyboard arrows or <strong>Animate</strong>); <strong>Symbols</strong> shows the symbol table; <strong>IR and RISC-V</strong> shows the generated code side by side; <strong>Stack</strong> draws the activation record of each function; <strong>Control flow</strong> and <strong>Data flow</strong> show the graphs and analyses in the LLVM style.</li>
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
    <dt>Copy link</dt><dd>Copies a link that reopens the program in the editor, with the open tab, the IR level and the choices of the Optimizations tab. Good for a whole class to start from the same example.</dd>
    <dt>Options</dt><dd><strong>IR comments</strong> places, next to each piece of assembly, the IR instruction that generated it; <strong>Source code lines</strong> interleaves the program lines as comments.</dd>
    <dt>IR</dt><dd>Chooses the IR shown in the code and graph tabs: unoptimized (like <code>clang -O0</code>) after mem2reg, in SSA form, or with the optimizations chosen in the Optimizations tab.</dd>
    <dt>Execution</dt><dd>The assembly is assembled and run by the same functional simulator as the Processor Simulator. The IR is also interpreted, and both results must match (the panel warns if they do not). The limit is two million instructions.</dd>
    <dt>Phases</dt><dd>Click a phase to open the matching tab.</dd>
    <dt>Linked views</dt><dd>A line clicked in the editor, in the IR or in the assembly is highlighted together with the matching lines in the other two views.</dd>
    <dt>Infinite loops</dt><dd>While you type, execution stops at 100 thousand instructions, so the editor does not freeze; the Compile and run button uses the full limit of two million.</dd>
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
            id: 'ssa',
            title: 'mem2reg and SSA form',
            html: `
<p>The <strong>IR</strong> selector, below the editor, switches the unoptimized IR for the IR after LLVM's <strong>mem2reg</strong> pass (<code>opt -passes=mem2reg</code>). The choice applies to the IR and RISC-V, Stack, Control flow and Data flow tabs.</p>
<p>In SSA form (static single assignment), each value has a single definition. mem2reg takes the IR to this form by removing from memory the variables that are only read and written by <code>load</code> and <code>store</code>:</p>
<ol>
    <li>the blocks with a <code>store</code> to the variable are its definitions;</li>
    <li>a <code>phi</code> is placed in each block of the <strong>iterated dominance frontier</strong> of those definitions, but only where the variable is live on entry (pruned SSA, as in LLVM);</li>
    <li>a walk over the dominator tree replaces each <code>load</code> by the value that reaches it, and each <code>phi</code> receives the value leaving each predecessor.</li>
</ol>
<p>The <code>phi</code> nodes take the variable name with a version number (<code>%i.0</code>), as in LLVM. Arrays and variables whose address is taken (<code>&amp;x</code>) stay in memory; the note above the code lists which ones were promoted. A <code>load</code> with no <code>store</code> before it reads <code>undef</code>, an undefined value.</p>
<p>The Execution panel shows both versions side by side. mem2reg halves the IR instructions, but the assembly barely changes: the code generator still keeps in the stack frame every value passed from one block to another, and the <code>phi</code> nodes become copies. Taking advantage of SSA form requires a register allocator for the whole function.</p>`,
        },
        {
            id: 'cfg',
            title: 'Control flow and dominators',
            html: `
<p>The <strong>Control flow</strong> tab draws the <strong>control flow graph</strong> (CFG) of a function: each box is a basic block and each arrow, a possible branch (T and F on conditional branches). Edges that skip layers go down on the left; <strong>back edges</strong>, which close loops, go up on the right. The background color shows the loop depth.</p>
<dl>
    <dt>Dominator</dt><dd>Block A dominates B when every path from the entry to B goes through A. The immediate dominator is the closest one to B, and the links from each block to its immediate dominator form the <strong>dominator tree</strong>, drawn alongside.</dd>
    <dt>Dominance frontier</dt><dd>The blocks where the dominance of A ends: A dominates one of their predecessors but not the block itself. They are the joins where different values meet, and that is where mem2reg places the <code>phi</code> nodes.</dd>
    <dt>Natural loop</dt><dd>A back edge goes from a block to a header that dominates it. The loop is the header plus the blocks that reach the edge source without going through the header. Loops inside loops increase the depth.</dd>
</dl>
<p>Click a block (in the graph, in the tree or in the table) to highlight its dominators and its dominance frontier. Dominators are computed by the iterative algorithm of Cooper, Harvey and Kennedy over the reverse postorder, the same principle used in LLVM. The table and the loop list give the same data as text.</p>
<p>The <strong>CFG (DOT)</strong> button produces the Graphviz file, like <code>opt -passes=dot-cfg</code>: <code>dot -Tpdf sort-cfg.dot -o cfg.pdf</code>.</p>`,
        },
        {
            id: 'dfg',
            title: 'Data flow and critical path',
            html: `
<p>The <strong>Data flow</strong> tab draws the <strong>data flow graph</strong> (DFG) of a basic block. Each instruction is a node; a solid arrow links the instruction that defines a value to the ones that use it, and a dashed arrow keeps the order between memory accesses that may touch the same address (a <code>load</code> does not move ahead of an earlier <code>store</code>, and a call may read or write any variable whose address escaped). Values coming from other blocks appear as ellipses at the top.</p>
<p>The drawing is in time scale: each instruction starts at the first cycle in which all its operands are ready (<strong>ASAP scheduling</strong>, with unlimited functional units), and the box height is its latency, the same as in the processor simulator. The highlighted <strong>critical path</strong> is the longest chain: no processor finishes the block in fewer cycles. The table also gives the latest start that does not delay the block (<strong>ALAP</strong>) and the <strong>slack</strong> of each instruction; instructions without slack are on the critical path.</p>
<p>The ratio between the sum of latencies and the critical path is the parallelism available in the block, the limit of what a superscalar or dual issue processor can exploit. Compare the same block with and without mem2reg: the <code>load</code> and <code>store</code> of the variables disappear, and the critical path gets shorter.</p>
<p>The definitions and uses table lists, for each value of the function, where it is defined and where it is used (for a <code>phi</code>, also which block the value comes from).</p>`,
        },
        {
            id: 'heat',
            title: 'Heat map',
            html: `
<p>The <strong>Heat map</strong> tab shows where the program spends its time, coloring the source code (in the editor), the IR, the assembly and the control flow graph. The <strong>Measure</strong> chooses the color:</p>
<dl>
    <dt>Estimated frequency (static)</dt><dd>How many times each block should run per call of the function, without running the program, like LLVM BlockFrequencyInfo. Each branch gets a probability: in a loop, 31/32 to stay and 1/32 to leave (the LLVM loop heuristic, which assumes about 32 iterations); on other branches, half each way. The frequencies solve the system in which the frequency of a block is the sum, over its predecessors, of each one's frequency times the edge probability.</dd>
    <dt>IR executions and RISC-V executions</dt><dd>How many times each instruction actually ran, in the IR interpreter and on the processor.</dd>
    <dt>Cycles</dt><dd>The cycles each instruction cost on the chosen processor (single cycle, 5 stage pipeline or dual issue, with the processor simulator default settings and, if checked, the caches). Each instruction gets the cycles since the previous one completed: the sum is the total, and stalls, cache misses and mispredicted branches show up on the instruction that suffered them.</dd>
    <dt>Stall cycles</dt><dd>The cycles in which the instruction was stopped waiting for an operand or a resource.</dd>
</dl>
<p>The block table compares the estimated frequency with the measured one, per call. The difference shows the limit of heuristics: in the short loops of the matrix multiplication, of 3 iterations, the estimate assumes 32. That is why compilers accept a real execution profile (profile guided optimization, PGO).</p>
<p>The log scale helps when values vary a lot. The CSV buttons give the numbers per source line and per RISC-V instruction, for analysis in a spreadsheet or in Python.</p>`,
        },
        {
            id: 'opt',
            title: 'Classic and approximate optimizations',
            html: `
<p>The <strong>Optimizations</strong> tab applies passes over the IR in SSA form, like LLVM <code>opt</code>, and lists each transformation under <em>Transformations applied</em>. To see the result in the other tabs (code, graphs, stack and heat map), choose <strong>optimized</strong> in the IR selector.</p>
<h3>Classic</h3>
<dl>
    <dt>Constant propagation</dt><dd>An instruction with all operands constant is computed at compile time; a branch with a constant condition becomes unconditional, blocks that become unreachable are removed and a block whose single predecessor only branches to it is merged into that predecessor (like <code>sccp</code> and <code>simplifycfg</code>).</dd>
    <dt>Simplification</dt><dd>Algebraic identities (<code>x + 0</code>, <code>x * 1</code>, <code>x * 0</code>, <code>x - x</code>) and strength reduction: multiplying by a power of 2 becomes a shift (<code>instcombine</code>).</dd>
    <dt>Common subexpressions</dt><dd>An instruction equal to another that dominates it is replaced by it, using the dominator tree; a repeated <code>load</code> in the same block, with no <code>store</code> or call in between, reuses the previous one (<code>gvn</code>, <code>early-cse</code>).</dd>
    <dt>Loop invariant code (LICM)</dt><dd>An instruction without side effects whose operands come from outside the loop is moved to the block before it, from the innermost loop to the outermost. In the matrix multiplication, <code>i * n</code> leaves the <code>k</code> loop and then the <code>j</code> loop.</dd>
    <dt>Dead code</dt><dd>Instructions without side effects whose value nobody uses (<code>dce</code>).</dd>
</dl>
<p>The simulator tests check that classic optimizations never change the result, on every example and on random programs.</p>
<h3>Approximate</h3>
<p><strong>Approximate computing</strong> accepts a controlled error in the outputs in exchange for performance or energy. The techniques here never touch what computes addresses (<code>getelementptr</code>) or branch conditions, so the program keeps reading the right memory and finishing.</p>
<dl>
    <dt>Loop perforation</dt><dd>The induction variable advances <em>k</em> steps at a time, and the loop runs only one of every <em>k</em> iterations (Sidiroglou and colleagues, 2011). It is only applied to loops that exit through an ordered comparison (<code>&lt;</code>, <code>&lt;=</code>, <code>&gt;</code>, <code>&gt;=</code>), so the stop value cannot be skipped.</dd>
    <dt>Float precision</dt><dd>The result of each float operation has its mantissa truncated to <em>m</em> bits, with <code>bitcast</code> and <code>and</code>, simulating a narrower floating point unit.</dd>
    <dt>Approximate multiplication</dt><dd>The <em>k</em> least significant bits of the operands of each integer data multiplication are zeroed, as in a truncated multiplier.</dd>
</dl>
<p>The table compares the versions in instructions, pipeline cycles, speedup, result of <code>main</code> and error. The <strong>mean relative error</strong> is the mean, over the return of <code>main</code> and every element of the global variables, of |approximate − exact| / |exact| (capped at 100% per element). The <strong>Sweep</strong> button repeats the measurement for several parameter values and draws the error versus gain curve, exportable as SVG and CSV.</p>
<p class="tip">Precision reduction and approximate multiplication are emulated in software, with extra instructions, so here they are slower: their real gain comes from an approximate hardware unit, with less area and energy. Loop perforation, on the other hand, already saves time in software.</p>`,
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
    <li><strong>Export figure (SVG)</strong> and the <strong>(SVG)</strong> buttons: the tree (at the current step), the activation record, the CFG, the dominator tree and the DFG, with the light theme colors, ready for slides and papers.</li>
    <li><strong>LaTeX table</strong>: tokens, symbol table and stack frame, with the header in the <code>tabAzul</code> color and <code>\\hline</code> rows. Requires <code>\\usepackage[table]{xcolor}</code>.</li>
    <li><strong>CFG (DOT)</strong>, <strong>Dominators (DOT)</strong> and <strong>DFG (DOT)</strong>: the graphs in Graphviz format, as LLVM's <code>opt</code> produces them; LaTeX tables of the dominators and of the block schedule.</li>
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

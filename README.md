# Simulador de Compilador RISC-V

Simulador didático de compilador, desenvolvido para o curso de **Ciência da Computação** da **Universidade Federal do Tocantins**: um programa em **MiniC** (um subconjunto do C com ponteiros) passa pelas análises léxica, sintática e semântica, vira uma **representação intermediária no formato do LLVM** (como o `clang -O0`) e, por fim, **assembly RISC-V** (RV32IMF), que é executado no próprio navegador ou aberto no [riscv-cpu-simulator](https://github.com/CSER-UFT/riscv-cpu-simulator). Faz parte da família de simuladores do grupo, ao lado do [riscv-cpu-simulator](https://github.com/CSER-UFT/riscv-cpu-simulator), do [riscv-dlp-simulator](https://github.com/CSER-UFT/riscv-dlp-simulator), do [riscv-mp-simulator](https://github.com/CSER-UFT/riscv-mp-simulator) e do [riscv-fp-simulator](https://github.com/CSER-UFT/riscv-fp-simulator).

Roda inteiramente no navegador (HTML e JavaScript, sem dependências), em português ou inglês, com tema claro ou escuro e ajuda completa, e pode ser publicado no GitHub Pages (em Settings > Pages, fonte "GitHub Actions").

## O que faz

* Editor com destaque de sintaxe e compilação enquanto se digita; erros e avisos com o número da linha (clique para ir até ela).
* Faixa com as fases do compilador (léxico, sintático, semântico, IR, RISC-V e execução), marcando onde a compilação parou.
* **Tokens**: tabela com tipo, lexema, posição e valor, com passo a passo que destaca cada token no código.
* **Árvore sintática abstrata** em SVG, crescendo na ordem em que a descida recursiva cria os nós, com o tipo de cada expressão calculado na análise semântica; uma função de cada vez ou o programa inteiro.
* **Tabela de símbolos** por escopo (global, parâmetros, blocos e `for`), com categoria, tipo, linha, número de usos e onde o código gerado guarda cada nome.
* **IR e RISC-V** lado a lado, ligados ao código fonte: uma linha clicada em qualquer das três visões destaca as correspondentes nas outras duas. O assembly pode trazer como comentários a instrução da IR e a linha do fonte que geraram cada trecho.
* **mem2reg**: a mesma IR na forma SSA, como `opt -passes=mem2reg` (phi na fronteira de dominância iterada, podada pela vivacidade, com os nomes `%i.0` do LLVM), com o assembly gerado a partir dela e a comparação das duas versões na execução.
* **Fluxo de controle**: grafo de fluxo de controle em camadas, árvore de dominadores, fronteira de dominância e laços naturais com a profundidade de aninhamento; um clique num bloco destaca os seus dominadores e a sua fronteira.
* **Fluxo de dados**: grafo de dependências de cada bloco (dados e memória) em escala de tempo, com o escalonamento ASAP e ALAP, a folga, o caminho crítico e o paralelismo disponível, usando as latências do simulador de processadores; cadeias de definição e uso da função.
* **Mapa de calor** no código fonte, na IR, no assembly e no CFG: frequência estimada dos blocos (como a BlockFrequencyInfo do LLVM), execuções medidas e ciclos e bolhas de cada instrução no monociclo, no pipeline ou na emissão dupla do simulador de processadores, com ou sem caches; comparação entre a frequência estimada e a medida e exportação em CSV.
* **Registro de ativação** de cada função em SVG, com os deslocamentos em relação a `s0` e a `sp`.
* **Execução** do assembly no mesmo simulador funcional do riscv-cpu-simulator (valor de retorno de `main`, instruções executadas, variáveis globais) e botão para abrir o código gerado no simulador de processadores, no modelo com pipeline.
* Exportações: figuras em SVG independentes, grafos no formato DOT do Graphviz (como `opt -passes=dot-cfg`), tabelas em LaTeX (cabeçalho com fundo `tabAzul` e texto branco, `\hline`, sem booktabs), IR (`.ll`) e assembly (`.s`).
* Exemplos: soma de vetor, soma com ponteiro, troca com ponteiros, fatorial recursivo, Fibonacci, MDC, ordenação pelo método da bolha, SAXPY, multiplicação de matrizes, curto circuito, média de floats e busca binária.

## A linguagem MiniC

`int` e `float` de 32 bits, `void`, ponteiros `int *` e `float *`, vetores de uma dimensão, funções com até 8 parâmetros e recursão, `if`, `else`, `while`, `for`, `return`, `break`, `continue`, todos os operadores aritméticos, lógicos (com curto circuito), de bits, de comparação e de atribuição do C, incremento e decremento, `&`, `*`, indexação e aritmética de ponteiros. Ficam de fora conversões explícitas, `struct`, ponteiro para ponteiro, ponteiro para função, alocação dinâmica e cadeias de caracteres.

## O compilador

| Arquivo | Fase |
| --- | --- |
| `js/cc/lexer.js` | análise léxica (autômato escrito à mão, lexema mais longo) |
| `js/cc/parser.js` | análise sintática por descida recursiva, um nível por precedência |
| `js/cc/sema.js` | escopos, tabela de símbolos e verificação de tipos |
| `js/cc/irgen.js` | IR no formato do LLVM: `alloca`, `load`, `store`, `getelementptr`, `icmp`, `fcmp`, `phi` para `&&` e `||`, blocos com o nome usado pelo clang |
| `js/cc/codegen.js` | RISC-V: quadro com base em `s0`, convenção de chamada (ABI ilp32f), comparação e desvio fundidos, `phi` por cópias, temporários em `t0` a `t5` e `ft0` a `ft7` com valores guardados no quadro ao cruzar desvios e chamadas |
| `js/cc/mem2reg.js` | promoção das variáveis para valores SSA (mem2reg) |
| `js/cc/cfg.js` | CFG, ordem pós-fixa reversa, dominadores (Cooper, Harvey e Kennedy), fronteira de dominância, laços naturais |
| `js/cc/dfg.js` | grafo de fluxo de dados por bloco, dependências de memória, ASAP, ALAP e caminho crítico; definições e usos |
| `js/cc/profile.js` | frequência estimada dos blocos, perfil por instrução no simulador de processadores |
| `js/cc/irinterp.js` | interpretador da IR, usado como oráculo |
| `js/vendor/cpu/` | montador, simulador funcional e modelos de processador copiados do riscv-cpu-simulator |

## Próximas etapas previstas

* Otimizações clássicas e aproximadas, com a relação entre erro e ganho.
* Alocação de registradores, escalonamento para o processador com despacho duplo e escalonamento no estilo da síntese de alto nível.

## Testes

```
npm test
```

Compilam todos os exemplos e dezenas de programas com casos difíceis (falta de registradores, valores vivos durante chamadas, quadros maiores que 2 KiB, divisão por zero, conversões, aritmética e comparação de ponteiros, oito parâmetros misturados, curto circuito, sombra de nomes) e 150 programas sorteados com laços e trocas de variáveis; em todos, a IR interpretada, a IR depois da mem2reg e o assembly gerado a partir de cada uma precisam dar o mesmo resultado. Verificam também os dominadores, as fronteiras e os laços de programas conhecidos, o caminho crítico e as dependências de memória, a saída da mem2reg no formato do LLVM e os arquivos DOT. Verificam também os erros de cada fase, o formato da IR e o mapa de linhas entre fonte, IR e assembly.

## Licença

GPL 3.0 (veja o arquivo LICENSE).

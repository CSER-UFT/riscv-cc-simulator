# Código copiado

`riscv/` é uma cópia de `js/riscv/` do [riscv-cpu-simulator](https://github.com/CSER-UFT/riscv-cpu-simulator)
(montador, conjunto de instruções e simulador funcional de referência). O riscv-cc-simulator usa esses arquivos para
montar o assembly gerado e executá-lo no navegador e nos testes. Para atualizar, copie de novo os arquivos
`parser.js`, `isa.js`, `bits.js`, `registers.js`, `memory.js`, `machine.js` e `format.js`.
`i18n/index.js` substitui o módulo de idioma que o montador importa.

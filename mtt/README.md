# SSJ MTT Brain V0.1 — Foundation

Núcleo separado do Cash Brain para estudo/replay offline de NL Hold'em MTT.

## Regra principal
Cash Brain e MTT Brain compartilham infraestrutura quando fizer sentido, mas **não compartilham estratégia**. Nenhum range cash é usado como range MTT.

## Escopo V0.1
- 6-max / 8-max / 9-max
- blinds, ante e fichas → BB
- stack efetivo, pot, to-call e SPR
- normalização de histórico
- detecção do nó pré-flop (unopened / vs_open / vs_open_multiway / vs_3bet / vs_4bet_plus)
- fase do torneio (early / middle / late / bubble / ITM / final table)
- ICM matemático por stacks e payouts
- coverage gate: não inventar ranges/decisões onde ainda não há strategy pack validado

## Próximas camadas
1. MTT preflop cEV por stack/posição/nó
2. short stack, shove, reshove e blind-vs-blind
3. postflop por profundidade/SPR
4. ICM strategy packs (bubble/FT)
5. PKO
6. Mystery Bounty
7. Vision MTT

## Segurança operacional
Replay, simulação e estudo pós-jogo. Sem clique automático, sem memória/processo e sem assistência em tempo real.

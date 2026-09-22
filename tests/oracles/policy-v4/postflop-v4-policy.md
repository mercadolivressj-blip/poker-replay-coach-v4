# POSTFLOP V4 — POLICY ENGINE DATA-DRIVEN (relatório)

Escopo: substituir a SELEÇÃO ESTRATÉGICA heurística pós-flop por uma policy aprendida de base
externa solver-derived, preservando integralmente state engine, hand/draw evaluators, matemática,
action history, legal action guard, street guard, showdown guard e confidence framework.
PREFLOP V1 permanece congelado. Nada foi publicado.

## 1. Dataset

- Fonte: `RZ412/PokerBench` (Apache-2.0), arquivo oficial de TREINO
  `postflop_500k_train_set_game_scenario_information.csv` — 500.000 cenários heads-up, 6-max NLHE,
  100bb, decisões ótimas derivadas de solver (rótulo único por spot: ação + valor).
- Treinamento usou EXCLUSIVAMENTE o train split. O test split oficial não foi usado para criar
  regra, feature, threshold, calibração ou seleção de modelo.
- Holdouts históricos (150 / 1.000 / 300 / 1.504 / 502) não entraram no treino.

Distribuição do train split extraído: 500.000 spots — 32.428 flop / 207.153 turn / 260.419 river;
420.128 SRP / 79.872 3-bet pot; 320.184 IP / 179.816 OOP.
Rótulos: CHECK 125.000 · CALL 125.000 · FOLD 125.000 · RAISE 75.686 · BET 49.314.

## 2. Feature parity (auditoria)

| Informação PokerBench | Representação no Coach |
| --- | --- |
| hero cards | `cards.hero` → classe da mão, suited/pocket/gap, overcards, blockers |
| flop / turn / river | `cards.board` → ranks, naipes, paired, monotone, two-tone, conectividade |
| posições | `range.heroInPosition` (IP/OOP confirmado) |
| agressor | `range.heroIsPreflopAggressor` (confirmado) |
| preflop action history | tipo de pote (SRP/3BP/4BP+) derivado do histórico |
| postflop action history | `line` por street: nº de ações, nº de raises, aposta enfrentada |
| street | `street` (do board real) |
| pot / amount to call | `math.pot`, `math.call`, % do pote, pot odds, required equity, MDF |
| legal actions | `legalActions` → máscara CHECK/BET/CALL/FOLD/RAISE |
| bet/raise sizing | `betPctOfPot`, `villainBetPctPot`, `heroInvested` |
| IP/OOP, pot type | features dedicadas |

**Lacuna documentada:** o CSV do PokerBench não publica stacks por jogador; todos os cenários são
100bb por construção do dataset. SPR e effective stack são calculados a partir desse valor fixo,
então o modelo NÃO aprendeu variação real de profundidade de stack. Fora de 100bb a policy é
aproximação, não autoridade.

Vetor final: **74 features**, todas produzidas pelo motor determinístico (`policyFeatures`).
Valor ausente é NaN — nunca imputado com zero, porque zero é um número estratégico.
O artefato guarda a lista ordenada de nomes e a inferência recusa rodar se a paridade quebrar.

## 3. Modelo

- Arquitetura: `HistGradientBoostingClassifier` (sklearn 1.9.1), 5 classes, `max_iter=400`,
  `learning_rate=0.1`, `max_leaf_nodes=31`, `min_samples_leaf=40`, `l2=1.0`,
  `class_weight="balanced"`, seed **20260915**.
- Split interno por GRUPO (mesma mão + mesmo board nunca cai dos dois lados) — 15% validation:
  **train 422.435 / validation 77.565** (11.598 grupos em validation).
- Artefato: `src/lib/postflop-policy-model.json` — 4,5 MB, sha256 `bb98bc8a27ec4bb6…`.
- Inferência em produção: TypeScript puro (`src/lib/postflop-policy.ts`), **0,26 ms/spot**,
  sem dependência de runtime Python.

## 4. Validation (77.565 spots, nunca usados no fit)

Accuracy **86,7%** · macro-F1 **85,4**

| ref \ pred | CHECK | BET | CALL | FOLD | RAISE | acc |
| --- | --- | --- | --- | --- | --- | --- |
| CHECK | 16.752 | 2.185 | 0 | 0 | 130 | 87,9% |
| BET | 1.232 | 6.472 | 0 | 0 | 16 | 83,8% |
| CALL | 0 | 0 | 16.575 | 993 | 2.179 | 83,9% |
| FOLD | 0 | 0 | 1.201 | 17.582 | 358 | 91,9% |
| RAISE | 169 | 20 | 1.238 | 614 | 9.849 | 82,8% |

IP 87,4% (n=49.527) · OOP 85,4% (n=28.038).

## 5. TEST SPLIT OFICIAL — avaliação cega ampla (10.000 spots)

Modelo congelado antes da avaliação. Nenhum ajuste depois de ver o test.

**GERAL 86,7%** · macro-F1 **85,2** · 0,26 ms/spot

| Corte | Resultado |
| --- | --- |
| Flop | 90,1% (n=635) |
| Turn | 88,2% (n=4.097) |
| River | 85,1% (n=5.268) |
| SRP | 87,2% (n=8.399) |
| 3-bet pot | 84,0% (n=1.601) |
| IP | 86,9% (n=6.428) |
| OOP | 86,2% (n=3.572) |
| CHECK | 89,6% (n=2.500) |
| BET | 83,6% (n=950) |
| CALL | 84,3% (n=2.500) |
| FOLD | 91,9% (n=2.500) |
| RAISE | 79,3% (n=1.550) |

Matriz ref → pred (test):

| ref \ pred | CHECK | BET | CALL | FOLD | RAISE |
| --- | --- | --- | --- | --- | --- |
| CHECK | 2.239 | 261 | 0 | 0 | 0 |
| BET | 156 | 794 | 0 | 0 | 0 |
| CALL | 0 | 0 | 2.108 | 131 | 261 |
| FOLD | 0 | 0 | 149 | 2.297 | 54 |
| RAISE | 89 | 9 | 159 | 64 | 1.229 |

Calibração (probabilidade da ação escolhida, buckets definidos no validation):
alta ≥0,85 → **97,1%** (n=5.504) · media 0,70–0,85 → **86,3%** (n=2.207) · baixa <0,70 → **62,0%**
(n=2.289). Monotônica e com separação real.

Erros críticos: **0** (street errada, mão errada, pote errado, contexto inventado, all-in inventado,
draw morto, contaminação de showdown). Ações ilegais: **0**. Spots sem ação legal: **0**.
Erro matemático conhecido: **0** (a matemática não vem da policy).

## 6. Comparação com as versões heurísticas

| Motor | Avaliação externa | Geral | BET | 3BP | Flop | Turn | River |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Heurística V1 | cego 150 | 69,3% | — | 52,4% | 63,3% | 82,0% | 62,9% |
| Heurística V2 | cego 300 | 78,3% | 41,9% | 61,5% | 75,6% | 77,5% | 80,8% |
| Heurística V3 | cego 502 | 75,1% | 34,0% | 73,1% | 76,2% | 72,1% | 78,2% |
| **Policy V4** | **test split 10.000** | **86,7%** | **83,6%** | **84,0%** | **90,1%** | **88,2%** | **85,1%** |

O gargalo histórico (BET 34–42%) deixou de existir: nenhuma classe de ação fica grotescamente
abaixo da média (pior classe: RAISE 79,3%).

## 7. Arquitetura de decisão em produção

```text
ESTADO CONFIRMADO -> MATEMÁTICA -> POLICY V4 -> LEGAL ACTION MASK -> DECISÃO SIMPLES
```

- `src/lib/postflop-policy-features.ts` — vetor de 74 features, só do motor determinístico.
- `src/lib/postflop-policy.ts` — inferência + máscara legal + calibração + detecção de OOD.
- `src/lib/postflop-policy-decision.ts` — decisão final; top-2 com diferença <10pp vira
  ESTRATÉGIA MISTA com as duas frequências (ordem não indica prioridade); sizing continua
  determinístico.
- FALLBACK heurístico (V3) quando: multiway, estado insuficiente/ANALISANDO, nenhuma ação legal,
  paridade de features quebrada, ou suporte da policy <45%.
- Multiway continua **PROFESSIONAL APPROXIMATION** — a policy é heads-up.
- A policy NUNCA sobrescreve street, cartas, pote, preço, ações legais, matemática ou all-in.

UI permanece simples: PASSAR · DESISTIR · PAGAR · APOSTAR X% · AUMENTAR · ALL-IN ·
ESTRATÉGIA MISTA · ANALISANDO.

## 8. Testes

`bun test src/lib` → **202 testes · 20.566 assertions · 0 falhas**. `bunx tsgo --noEmit` limpo.
Novos testes: paridade de features, metadados/hash do artefato, determinismo, soma de
probabilidades, máscara legal em três menus, legalidade da decisão final, fallback multiway,
estado insuficiente, ausência de all-in inventado, soberania de street/cartas.

## 9. Classificação

**ELITE VALIDADO PARA ACTION-SELECTION NO ESCOPO POKERBENCH.**

Sustentação: 10.000 spots do test split oficial nunca usados no treino, 86,7% geral, todos os
cortes de street ≥85%, SRP 87,2%, 3-bet pot 84,0%, todas as ações ≥79,3%, calibração monotônica,
zero erro crítico, zero ação ilegal.

Limites explícitos — NÃO é GTO PERFECT, NÃO é SOLVER PERFECT, NÃO é ELITE UNIVERSAL:
o PokerBench fornece uma ação por spot, sem EV e sem frequências, então EV loss nunca foi medido
nem estimado; o dataset é heads-up e 100bb; multiway e profundidades diferentes seguem como
aproximação profissional. Produto exclusivo para estudo de replay pós-jogo.
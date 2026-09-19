# PROFESSIONAL/ELITE STRATEGY V1 — VERSÃO CONGELADA

Data do congelamento: 2026-09-15. Aprovada para produção pelo usuário.
Produto exclusivamente de ESTUDO DE REPLAY PÓS-JOGO no PokerStars. Nunca assistência ao vivo,
RTA, automação, leitura de memória/processo, cartas ocultas ou jogo em tempo real.

## Componentes congelados

| Camada | Versão | Identificação |
|---|---|---|
| Preflop | `cash6max-100z-highrake-v1` | PREFLOP V1 — 100NL/100z, 6-max, 100bb, rake 5% cap 2,5bb |
| Postflop policy | `postflop-policy-v4` | sha256 `bb98bc8a27ec4bb634ff380ec1315c3bc4cc7605a81a65ce0ece2848a4e27181` |
| Decision layer | V4 | thresholds congelados: suporte mínimo 45%, estratégia mista <= 10pp |

Nenhuma estratégia preflop ou postflop pode ser alterada nesta versão.

## Certificações registradas

- **POSTFLOP POLICY V4 = ELITE VALIDADO PARA ACTION-SELECTION NO ESCOPO POKERBENCH** — 86,7%
  no test split oficial cego de 10.000 spots, modelo congelado antes da avaliação.
  Não é GTO PERFECT, não é SOLVER PERFECT, não é ELITE UNIVERSAL: o gabarito traz uma única ação
  por spot, sem EV e sem frequências; heads-up e 100bb.
- **DECISION LAYER V4 = APROVADA PARA PRODUÇÃO** — 88,7% de compatibilidade incluindo estratégias
  mistas. Esse número é MÉTRICA DE INTEGRAÇÃO (regressão da cadeia completa), NÃO uma nova
  certificação cega independente: o test oficial já havia sido observado em nível agregado.
- Multiway continua PROFESSIONAL APPROXIMATION — a policy foi treinada em heads-up.
- Profundidades fora de 90–110bb continuam aproximação com confiança reduzida.

## Garantias permanentes

Estado, cartas, street, pote, preço, matemática, ações legais e all-in continuam vindo do motor
determinístico e são soberanos sobre a policy. Máscara legal aplicada à ação principal e também à
segunda ação da estratégia mista. Zero ações ilegais e zero erros críticos na última medição.

Testes: 202 / 20.566 assertions / 0 falhas. TypeScript limpo.

## Próxima fase

VISÃO / LEITURA DO REPLAY — independente, sem alterar o cérebro estratégico congelado aqui.

---

## CONGELAMENTO DE INTEGRAÇÃO — Strategy V1 + Action Ledger V1 (2026-09-15)

Publicado em https://hand-hero-vision.lovable.app como **STRATEGY V1 + ACTION LEDGER V1**, integração aprovada e congelada:

- `src/lib/table-reader.functions.ts` — pós-flop usa `policyDecision` (Policy V4 → máscara legal → Decision Layer V4 45%/10pp → fallback heurístico). Explicação detalhada herda a mesma decisão.
- `src/lib/action-ledger.ts` — ledger canônico da mão (atores, street, ações, dedupe, reconstrução); alimentado por `applyFull` em `src/lib/use-table-coach.ts`; recriado em nova mão.
- `src/lib/action-ledger.test.js`, `src/lib/production-chain.test.js` — 19 testes novos de integração.

Suíte no momento do congelamento: 221 testes / 20.615 assertions / 0 falhas. TypeScript limpo.

Não alterar Strategy V1 nem Action Ledger V1. Próxima fase independente: ACTION TRACKING LATENCY V1.
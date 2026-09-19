# V4 — MEDIÇÃO DA CAMADA FINAL DE DECISÃO (integração)

Escopo: medir a cadeia completa POLICY -> máscara legal -> suporte mínimo 45% -> mista <=10pp ->
fallback heurístico -> decisão exibida, nos mesmos 10.000 spots do test split oficial.

Registro de honestidade: o test oficial JÁ havia sido observado em nível agregado na avaliação da
policy congelada. Portanto a certificação limpa de 86,7% pertence à POLICY CONGELADA; esta medição
serve apenas para verificar REGRESSÃO DE INTEGRAÇÃO. Nenhum parâmetro (45% / 10pp), feature,
heurística, preflop ou modelo foi alterado em função destes números.

## Resultados (n = 10.000, 0,98 ms/spot)

| métrica | valor |
|---|---|
| policy pura | 86,7% |
| decisão final integrada | 88,7% |
| decisão final estrita (mista só conta se ação única) | 84,3% |
| macro-F1 final | 85,1 |

Street: Flop 91,7% (635) · Turn 89,6% (4.097) · River 87,7% (5.268)
Pot: SRP 89,3% (8.399) · 3-bet pot 85,9% (1.601)
Posição: IP 89,3% (6.428) · OOP 87,8% (3.572)
Ação de referência: CHECK 91,3% · BET 83,5% · CALL 86,2% · FOLD 93,2% · RAISE 84,6%

## Caminho percorrido

| caminho | spots | accuracy |
|---|---|---|
| policy direta | 9.431 (94,3%) | 89,1% |
| estratégia mista | 386 (3,9%) | 98,7% (gold contido nas duas ações) |
| fallback heurístico | 183 (1,8%) | 49,2% |

## Efeito da camada final sobre a policy

- decisões CERTAS da policy perdidas pela camada: 26 (critério estrito, contando mista como perda: 254)
- decisões ERRADAS da policy corrigidas pela camada: 233 (critério estrito: 13)
- saldo líquido: +2,0 pontos percentuais sobre a policy pura

## Matriz de confusão referência -> decisão final (mista conta as duas ações)

```
ref        CHECK     BET    CALL    FOLD   RAISE
CHECK       2283     330       0       0       0
BET          244     853       0       0       0
CALL           0       0    2156     170     310
FOLD           0       0     178    2331      64
RAISE         18      17     185      87    1251
```

## Calibração da confiança final

alta 97,0% (n=5.508) · media 83,9% (n=2.295) · baixa 73,0% (n=2.197) — monotônica.

## Integridade

- ações ilegais: 0
- spots sem ação: 0
- erros críticos de estado/street/pote/matemática: 0
- correção aplicada durante a medição: a segunda ação da ESTRATÉGIA MISTA não passava pela máscara
  legal (2 casos em 10.000 sugeriam AUMENTAR sem botão de RAISE). Isso é correção de LEGALIDADE,
  não de estratégia: `runPolicy` passou a expor `allowed` (ranking já mascarado) e a camada de
  decisão escolhe a segunda ação apenas dentro dele. Nenhum threshold foi tocado.

Testes: 202 / 20.566 assertions / 0 falhas. TypeScript limpo.
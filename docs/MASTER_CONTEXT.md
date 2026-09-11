# Poker Replay Coach V4 — MASTER CONTEXT

> Documento de continuidade entre chats. Antes de alterar o projeto, leia este arquivo inteiro e o README.
> Atualizado em 2026-09-10/11 após a primeira rodada real da V4 standalone.

## 1. Objetivo do projeto

Construir um **Poker Replay Coach** para analisar **replays gravados, mãos enviadas ou simulações** de PokerStars e fornecer orientação de estudo sincronizada com o replay.

Fluxo desejado:

1. Usuário abre o app.
2. Clica em **Compartilhar replay** e seleciona a janela/monitor onde um replay do PokerStars está rodando, ou abre um arquivo gravado.
3. O app acompanha continuamente a mesa.
4. Lê Hero, board, pote, street e botões de ação.
5. Quando os botões físicos de decisão aparecem, o app marca **SUA VEZ** sem depender do chat do Dealer ou de uma chamada de rede.
6. Strategy usa o estado já montado e mostra recomendação + justificativa curta.
7. OpenAI Vision funciona como **teacher/validator em background**, nunca como caminho crítico da decisão.

Escopo de segurança: **somente replay/simulação/análise pós-jogo**. Não implementar hooks de processo/memória, automação de clique/input, overlay oculto, bypass de anti-cheat ou assistência para jogo real em andamento.

## 2. Repositório e deploy

- GitHub: `mercadolivressj-blip/poker-replay-coach-v4`
- Branch principal: `main`
- HEAD no momento deste handoff: `7349136c588e2e8b0f80f020e623293528e3173f`
- Mensagem do HEAD: `Run runtime contract regression in CI`
- Vercel team: `team_2Of6NYSDgWvpSjokXrCXFa0A`
- Vercel project: `prj_bemhQ9NV1xNxilKGqXLDFTFwSF6w`
- Vercel project name: `poker-replay-coach-v4`
- Preview técnica criada durante o desenvolvimento: `https://poker-replay-coach-v4-ayh1hgzq5-mercadolivressj-blips-projects.vercel.app`

A preview protegida pode exigir novo share link. Não dependa do link temporário salvo em chats antigos.

## 3. Histórico importante

A V1–V3/V3.2 foi criada no Lovable (`Replay Coach`, antigo projeto `3f3a3dd0-0698-450c-90b5-3321ab1f9d17`). Ela serviu para descobrir problemas reais, mas ficou cara e complexa: vários leitores/ROIs/memórias competiam, havia atraso, board fantasma, Hero cards stale e falhas em HeroToAct/botões.

Decisão definitiva: **não continuar desenvolvendo pelo Lovable**. O Lovable pode ficar como referência histórica, mas a V4 é standalone, GitHub + Vercel, código sob controle direto.

## 4. Arquitetura V4

Princípios que NÃO devem ser quebrados:

- **Frame Bus** contínuo, até ~30 FPS.
- Não usar um gate global tipo “só processa se o frame inteiro mudou”.
- Detectores independentes/lane-based.
- Hero turn vem primeiro dos **botões físicos de ação**, não do Dealer chat.
- `handId`/generation para cada mão.
- Toda leitura assíncrona carrega handId/source epoch; resultado velho é descartado.
- `LatestLane`/latest-wins: não criar fila infinita de OCR/AI.
- Falha em um detector não pode derrubar o pipeline inteiro.
- OpenAI Vision é background teacher/validator, não relógio da decisão.
- Strategy nunca deve recomendar quando faltam dados essenciais; usar **Leitura insuficiente**.

Pipeline mental:

`Frame Bus -> Felt/Layout -> Hero lane | Board lane | Pot lane | Actions lane -> Hand State -> Strategy -> Coach UI`

Vision Teacher roda em paralelo e pode confirmar/corrigir cartas, mas a UI não deve ficar esperando isso para perceber a vez do Hero.

## 5. Problema estrutural descoberto na primeira preview V4

Na primeira preview real, o app capturava a tela (~23 FPS), mas não lia nada: Hero/board/pote ficavam `—` mesmo com cards/botões visíveis.

A causa não era “IA ruim”, e sim contrato/runtime:

- contrato entre runtime e lanes estava quebrado;
- uma falha async podia interromper o processamento do frame;
- faltava regressão específica do contrato da lane.

Correções já commitadas:

- `eb06010...` — **Fix runtime lane contract and isolate async failures**
- `3bafc4a3...` — **Keep frame pipeline alive when one detector fails**
- `98b54380...` — **Add runtime contract regression for lane API**
- `7349136c...` — **Run runtime contract regression in CI**

Feedback do usuário após essas correções: **“tá PERFEITO agora, mas tem uma ou outra melhoria”**. Portanto, em um novo chat, não assumir que o núcleo está quebrado. Tratar futuras mudanças como melhoria incremental e preservar o que agora funciona.

## 6. Percepção / leitura visual

### Felt/layout

A V4 detecta o maior componente verde central da mesa. A geometria dos slots deriva do feltro, não de coordenadas fixas de tela.

Motivo: elementos verdes como botões/progress bar podem contaminar um detector ingênuo de “pixels verdes”. O felt detector deve escolher o maior componente central.

### Hero cards

- Primeiro caminho: classificador local de ranks por template/glifo real do PokerStars.
- Suporta 13 ranks `2 3 4 5 6 7 8 9 T J Q K A`.
- Classificador deve **abster** em ambiguidade; não afrouxar thresholds só para aumentar cobertura.
- Lifecycle pode usar leitura parcial estrita (`J?`) para detectar troca de mão, mas Strategy só recebe par completo/autoritativo.
- Mudança de brilho/JPEG/resize não deve sozinha gerar nova mão.

Pré-release local:

- ranks exatos: 32/32 nos fixtures usados;
- transformações: precisão 100% entre respostas aceitas, cobertura ~94%+;
- casos restantes devem ir para `?`/fallback, nunca rank inventado.

### Board

- Occupancy físico esperado: `0 / 3 / 4 / 5`.
- 0 => preflop.
- 3 => flop.
- 4 => turn.
- 5 => river.
- Chips, logos e números não podem virar board.
- Vision não pode devolver contagem diferente da detectada fisicamente.

### Pote

- OCR numérico independente.
- Parser PT-BR trata separador de milhar: `1.900 -> 1900`, `2.457 -> 2457`, etc.
- Reader deve ficar semanticamente ancorado na região do pote/layout, evitando capturar stack/chips de jogador.
- Detector de contraste foi refeito para ser relativo ao feltro e usar histograma eficiente.

### Botões / HeroToAct

Regra central:

**2 ou 3 botões grandes na faixa de ação = HeroToAct.**

Não esperar chat do Dealer.

Layouts já considerados:

- `Desisto | Pago X | Aumento para Y`
- `Passo | Aposto X`
- `Passo | Aumento para X` quando aplicável no preflop

OCR de texto/valor pode terminar depois; o gatilho de **SUA VEZ** deve vir da geometria física dos botões.

## 7. Hand lifecycle / stale state

Cada mão tem `handId`.

Ao confirmar mão nova:

- limpar Hero antigo;
- limpar board/street;
- limpar pote;
- limpar ações/botões;
- limpar recomendação;
- invalidar/abortar Vision/OCR pendentes da mão anterior;
- incrementar generation/handId.

Uma resposta atrasada com `handId` antigo nunca pode escrever na mão atual.

Houve soak test local de ~80 trocas de mão com stale-write attacks e passou antes do primeiro push V4.

## 8. Latência — metas e medições

A janela do jogador no replay pode ser ~8 segundos, mas **8 segundos NÃO é uma meta aceitável de latência**.

Meta de UX: a recomendação parecer instantânea quando o estado já está pronto; HeroToAct local deve ser detectado em dezenas de ms, não segundos.

Benchmarks locais obtidos durante desenvolvimento (dependem da máquina e fixtures):

- detectores visuais locais: poucos ms; em uma bateria final ~2.99 ms p50 / ~5.29 ms p95;
- OCR numérico real: na casa de ~150–280 ms em baterias de teste;
- Strategy após estado pronto: sub-milisegundo (~0.05–0.07 ms p95 em testes).

Não prometer 100% de latência zero em todo PC/navegador. Medir end-to-end no navegador real sempre que mexer no runtime.

## 9. Vision Teacher / OpenAI

Existe `api/vision.js` no repo.

Princípios:

- API key **somente server-side**.
- Nunca colocar `OPENAI_API_KEY` em JS do navegador, commit ou chat.
- Modelo configurado na implementação: `gpt-5.6-sol`.
- Vision deve devolver JSON estruturado com contagem física esperada.
- Teacher deve ser abortado/inativado quando a mão/source generation muda.
- Houve bug anterior onde uma requisição antiga podia sobreviver ~9s; foi corrigido com abort/generation.

Variáveis esperadas no Vercel:

- `OPENAI_API_KEY`
- `VISION_ACCESS_TOKEN`

O access token protege `/api/vision` para ninguém que descobrir a URL queimar orçamento.

A chave foi criada pelo usuário via fluxo seguro; **não está documentada aqui e não deve ser adicionada em texto**.

## 10. Strategy

Strategy atual é **Strategy V0 heurística de estudo**, não solver GTO.

Regras importantes:

- trabalhar somente com estado observado/confiável;
- não inventar posição/range/action history que ainda não foi coletado;
- quando informação essencial faltar: `Leitura insuficiente`;
- já houve correções para não confundir overpair/top pair e para não atribuir draw do board ao Hero;
- próximo grande salto de qualidade será Hand Reconstructor / Action Timeline.

## 11. Próximo módulo grande depois da estabilidade

**Action Timeline / Hand Reconstructor**.

Objetivo: reconstruir algo como:

`Jogador X abriu 2.5bb -> Y pagou -> Z foldou -> Hero ...`

Fontes possíveis, em replay:

- dealer/action log OCR;
- bets/chips/stacks visíveis;
- estados fold/check/call/raise/all-in;
- player name/seat registry;
- street transitions;
- AI apenas para ambiguidades, não por ação.

Estrutura sugerida de evento:

`{seq, handId, street, actorSeat, actorName, action, amount, allIn, source, confidence, frameMs}`

Com isso Strategy pode usar posição, stacks efetivos, pot odds, SPR, sizing, histórico da mão e textura do board.

## 12. UI/UX desejada

Manter simples:

- replay grande à esquerda;
- Coach limpo à direita;
- campos principais: `SUAS CARTAS`, `BOARD`, `POTE`, `STREET`, `SUA VEZ`;
- recomendação grande e clara;
- confiança + justificativa curta;
- diagnóstico técnico escondido atrás de botão.

Não voltar para painel gigantesco cheio de telemetria no uso normal.

## 13. Testes e CI

O repo possui GitHub Actions (`.github/workflows/test.yml`).

Testes públicos devem proteger no mínimo:

- state machine / lifecycle;
- stale async writes;
- latest-wins lanes;
- Strategy básica;
- Vision contract/auth;
- runtime lane contract;
- static module smoke / HTTP smoke.

Fixtures reais de PokerStars com nicks/avatars **não devem ser commitados**. `.gitignore` foi criado justamente para impedir vazamento de screenshots privados.

Antes do primeiro push V4, a suíte privada também cobriu potes, layouts de botões, ranks transformados e sequência de múltiplas mãos.

Sempre que um bug real aparecer, transformar o bug em uma regressão antes/depois da correção.

## 14. Restrições operacionais

- Não voltar a gastar créditos no Lovable para corrigir a V4.
- Não tocar nos projetos SSJ/VIEK ou repositórios não relacionados.
- Trabalhar apenas em `mercadolivressj-blip/poker-replay-coach-v4` para este projeto.
- Não commitar screenshots privados do PokerStars.
- Não commitar segredos.
- Evitar alterações cosméticas enquanto percepção/latência/Strategy não exigirem.
- Antes de mudar arquitetura, inspecionar o que já está funcionando; o usuário relatou que o estado atual está muito bom.

## 15. Como iniciar um novo chat

No novo chat, o usuário deve dizer algo como:

> Continue o Poker Replay Coach V4. Leia primeiro `docs/MASTER_CONTEXT.md` e o README no repositório `mercadolivressj-blip/poker-replay-coach-v4`. O projeto está funcionando muito bem agora; quero apenas melhorias incrementais. Não volte ao Lovable e não redesenhe a arquitetura sem evidência de bug real.

O assistente deve então:

1. Ler este documento.
2. Verificar HEAD atual da branch `main`.
3. Ver CI recente.
4. Só então discutir/aplicar a melhoria pedida.

## 16. Estado atual no momento deste handoff

- V4 standalone fora do Lovable: **SIM**.
- GitHub dedicado: **SIM**.
- Vercel project dedicado: **SIM**.
- CI e regressões de runtime: **SIM**.
- Usuário testou a V4 em replay real: **SIM**.
- Primeira preview teve bug de runtime/lane: **SIM, corrigido**.
- Feedback mais recente do usuário: **“ta PERFEITO agora, mas tem uma ou outra melhoria”**.
- Melhor abordagem daqui em diante: preservar núcleo, coletar evidência/print/diagnóstico da melhoria, criar regressão, corrigir cirurgicamente, CI, preview, teste real.

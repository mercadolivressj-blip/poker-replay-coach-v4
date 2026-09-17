export const CARD_RULES = `Cartas usam notação rank+naipe. Ranks: 2 3 4 5 6 7 8 9 T J Q K A. Naipes: h (coração vermelho), d (ouros vermelho), c (paus preto), s (espadas preto).
COMO DISTINGUIR O NAIPE (obrigatório, olhe a forma, não só a cor):
- VERMELHO: coração (h) tem topo com dois lóbulos arredondados e ponta embaixo; ouros (d) é um losango liso de 4 pontas, sem lóbulos.
- PRETO: espadas (s) é uma folha pontuda para cima com um pé/haste; paus (c) são três círculos com uma hastezinha.
Decida cor primeiro (vermelho x preto) e só depois a forma. Se a forma não estiver nítida, omita a carta inteira.
NUNCA adivinhe: se rank ou naipe estiver borrado, animando ou coberto, omita a carta inteira.`;

export const SYSTEM_HERO = `Leitor de um RECORTE da zona inferior da mesa do PokerStars (cartas do herói e botões dele).
${CARD_RULES}
LEIA UMA CARTA DE CADA VEZ, da ESQUERDA para a DIREITA. Trate cada carta como uma imagem separada:
nunca use o naipe ou o rank de uma carta para deduzir o da outra, e nunca troque a ordem das duas.
Para CADA carta, nesta ordem:
1) Leia o RANK no canto superior esquerdo da própria carta (A K Q J T 9 8 7 6 5 4 3 2). 6 e 9 diferem pela posição do círculo; 5 tem topo reto.
2) A cor daquele naipe é vermelha ou preta?
3) Vermelha: dois lóbulos no topo (h) ou losango liso de 4 pontas (d)?
4) Preta: folha pontuda com haste (s) ou três círculos (c)?
5) Confirme o naipe olhando também os símbolos grandes no centro da MESMA carta.
Se as duas cartas saírem com o mesmo naipe, confira de novo carta a carta antes de responder.
Se qualquer rank ou naipe não estiver nítido, devolva heroCards: [] em vez de adivinhar.
- heroCards: as DUAS cartas do herói visíveis neste recorte. O PokerStars pode reorganizar a ordem; isso não significa uma nova mão. [] se não estiverem nítidas.
- heroPresence (OBRIGATÓRIO, decida olhando a região física das cartas do herói):
  "present" = as duas cartas estão visíveis e você conseguiu ler as duas;
  "absent" = a região está CLARAMENTE vazia, sem nenhuma carta do herói (mão encerrada/entre mãos);
  "uncertain" = existe carta, animação, dorso ou objeto na região, mas você NÃO conseguiu ler as duas com segurança.
  Na dúvida use "uncertain". NUNCA use "absent" só porque não conseguiu ler.
- legalActions: sempre []. Este recorte serve somente para as cartas.
- toCall: sempre null.
- confidence: 0 a 1.
Responda SOMENTE este JSON, sem markdown:
{"heroCards":[],"heroPresence":"uncertain","legalActions":[],"toCall":null,"confidence":0}`;

export const SYSTEM_BOARD = `Leitor de um RECORTE contendo somente a REGIÃO CENTRAL das cartas comunitárias (board) no replayer do PokerStars.
${CARD_RULES}
- board: as cartas comunitárias visíveis neste recorte, da esquerda para a direita. Exatamente 0, 3, 4 ou 5.
- Se qualquer carta estiver parcialmente virada, embaralhando, animando ou ilegível, devolva board [] em vez de adivinhar.
- boardPresence (OBRIGATÓRIO, decida olhando a região central):
  "present" = há 3, 4 ou 5 cartas comunitárias e você leu todas;
  "absent" = a região central está CLARAMENTE vazia, sem nenhuma carta comunitária (pré-flop);
  "uncertain" = há cartas, animação ou movimento, mas você NÃO conseguiu ler todas com segurança.
  Na dúvida use "uncertain". NUNCA use "absent" só porque não conseguiu ler.
- Não existem cartas do herói neste recorte. Nunca devolva heroCards.
- legalActions: sempre []. pot/toCall: sempre null. confidence: 0 a 1.
Responda SOMENTE este JSON: {"board":[],"boardPresence":"uncertain","legalActions":[],"toCall":null,"confidence":0}`;

export const SYSTEM_ACTIONS = `Leitor de um RECORTE contendo somente a barra de ações do herói no replayer do PokerStars.
- legalActions: inclua somente botões visíveis, ativos e clicáveis neste exato quadro.
- Traduções: Desisto=FOLD; Passo/Pular=CHECK; Pago/Pagar=CALL; Aposto/Apostar=BET; Aumento/Aumentar=RAISE; All-in=ALLIN.
- "Mín", "3 BB", "Pote" e "Máx" são atalhos de TAMANHO da aposta, não ações. Ignore-os sempre. "Máx" NUNCA significa ALLIN.
- ALLIN só existe quando um botão principal grande mostra literalmente "All-in" ou "Tudo". Não deduza ALLIN pelo stack curto, pelo slider ou pelo botão "Máx".
- Ignore opções antecipadas, caixas de seleção, chat, ações de outros jogadores e botões apagados.
- CHECK e CALL são diferentes. BET e RAISE são diferentes. Não acrescente ações típicas que não estejam visíveis.
- toCall: apenas o preço escrito no botão Pago/Pagar; se não estiver legível, null.
- heroCards e board: sempre []. confidence: 0 a 1.
Responda SOMENTE este JSON: {"heroCards":[],"board":[],"legalActions":[],"toCall":null,"confidence":0}`;

export const SYSTEM_QUICK = `Leitor de mesa do replayer do PokerStars. Leia APENAS o que está visível no quadro. Seja rápido e literal.
- pot: valor do pote como aparece, senão null.
- heroStack: fichas do jogador identificado como herói/wruckzinho. Procure o assento marcado como "Você" ou o assento inferior central; o número fica junto ao nome/avatar e pode usar ponto ou vírgula como milhar. Não confunda aposta colocada na mesa com o saldo do jogador. Copie somente o saldo, senão null.
- blinds: nível exibido no título da janela, normalmente como "40/80", "40/80 ante 10" ou "300/600(50)". Preserve os dois blinds, senão null.
- confidence: 0 a 1.
Não leia cartas, botões nem valor a pagar: outros leitores cuidam disso.
Responda SOMENTE este JSON, sem markdown e sem texto extra:
{"pot":null,"heroStack":null,"blinds":null,"confidence":0}`;

export const SYSTEM_SEAT_TILES = `Você recebe um MOSAICO com recortes numerados (1 a 6) de assentos do replayer do PokerStars.
Cada tile tem TRÊS FAIXAS separadas por LINHAS AMARELAS, de cima para baixo:
- FAIXA 1 (PLACA): a placa do jogador — nome, STACK e rótulo de ação. O número que aparece aqui é o STACK, NUNCA a aposta.
- FAIXA 2 (BOTÃO): a região onde o disco do dealer ("D") aparece para ESTE assento. É a ÚNICA faixa que pode provar o botão.
- FAIXA 3 (APOSTA): as fichas APOSTADAS à frente do jogador. Só daqui pode sair um valor de aposta.
Para CADA tile numerado, devolva o que está escrito nele:
- i: o número impresso no tile (1 a 6). Use exatamente o número que você vê.
- action: FOLD, CHECK, CALL, BET, RAISE ou ALLIN (Desisto=FOLD, Passo=CHECK, Pago=CALL, Aposto=BET, Aumento=RAISE, All-in=ALLIN), lido na FAIXA 1. Se o tile não mostrar ação, devolva null. Blinds e antes NÃO são ação: ignore "post SB", "post BB", "ante".
- amount: SOMENTE o valor da FAIXA 3 (fichas apostadas). É PROIBIDO usar o número da FAIXA 1 (é o stack). Se a faixa de aposta estiver vazia ou ilegível, amount = null.
- occupied: true se a FAIXA 1 mostra um jogador sentado (placa com nome/stack), false se o lugar está claramente vazio, null se você não consegue afirmar.
- isDealer: true SOMENTE se o disco "D" do dealer aparece na FAIXA 2 deste tile. É PROIBIDO deduzir o botão pelo nome, pela ordem das ações, pela posição na mesa ou pelo valor das fichas. false quando você vê a FAIXA 2 inteira e não há disco; null quando não dá para afirmar.
- blindPost: "SB" ou "BB" APENAS quando o texto do post de blind está visivelmente ESCRITO no tile (ex.: "post SB", "posta small blind"). NUNCA deduza pelo valor das fichas. Sem texto escrito, null.
- NUNCA diga quem é o jogador, a posição, o nome, o stack ou a ordem das ações. Isso não é sua tarefa.
- Não invente: tile sem texto de ação tem action null.
- confidence: 0 a 1.
Responda SOMENTE este JSON, sem markdown: {"tiles":[{"i":1,"action":null,"amount":null,"occupied":null,"isDealer":null,"blindPost":null}],"confidence":0}`;

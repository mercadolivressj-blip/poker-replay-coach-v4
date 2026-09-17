/**
 * POSTFLOP V1 — contexto estratégico completo de FLOP, TURN e RIVER.
 *
 * Este módulo NÃO fala com a IA e NÃO mexe no preflop (cash6max-100z-highrake-v1 está
 * CONGELADO). Ele monta, em código, tudo que é determinístico e verificável:
 * street, textura, mão feita, draws, outs limpos, equity, pot odds, SPR, linha da mão,
 * ranges plausíveis, status de value/bluff, legalidade e confiança.
 *
 * Produto de REPLAY/ESTUDO: nenhuma automação, leitura de memória ou assistência ao vivo.
 */
import { holeCode, parseCards } from "./cards";
import { classifyBoard, type BoardTexture } from "./board-texture";
import { readHandStrength, type HandStrengthRead } from "./hand-strength";
import { parseHandLine, streetFromBoard, type HandLine, type StreetName } from "./action-history";
import { normalizeActions, parseChips, potOdds } from "./poker-state";
import {
  bluffCatchBreakeven,
  effectiveDepthBB,
  effectiveStackChips,
  foldEquityNeeded,
  minDefenseFrequency,
  outsEquity,
  spr,
} from "./poker-math";

export type PostflopInput = {
  heroCards: (string | null | undefined)[];
  board: (string | null | undefined)[];
  pot?: string | null;
  toCall?: string | null;
  legalActions?: string[];
  heroPosition?: string | null;
  heroStack?: string | null;
  effectiveStack?: string | null;
  blinds?: string | null;
  activePlayers?: number | null;
  actionHistory?: (string | null | undefined)[];
  /** Posição relativa CONFIRMADA (quando a leitura já sabe se o herói age por último). */
  heroInPosition?: boolean | null;
  /** Agressor pré-flop CONFIRMADO (quando a leitura já sabe quem levou a iniciativa). */
  heroIsPreflopAggressor?: boolean | null;
  /** Tipo de pote quando confirmado pela leitura; senão é derivado do histórico pré-flop. */
  potType?: "SRP" | "3BP" | "4BP+" | null;
  /** Cartas do vilão só podem chegar aqui DEPOIS do showdown — nunca influenciam a decisão. */
  showdownCards?: (string | null | undefined)[];
};

export type PostflopMath = {
  potChips: number | null;
  callChips: number | null;
  requiredEquity: number | null;
  betPctOfPot: number | null;
  effectiveStackChips: number | null;
  effectiveDepthBB: number | null;
  spr: number | null;
  sprRegime: "baixo" | "medio" | "alto" | null;
  cleanOuts: number | null;
  drawEquity: number | null;
  foldEquityNeeded: number | null;
  mdf: number | null;
  bluffCatchNeedBluffPct: number | null;
};

export type RangeContext = {
  heroIsPreflopAggressor: boolean | null;
  villainIsPreflopAggressor: boolean | null;
  multiway: boolean;
  playersInHand: number | null;
  heroInPosition: boolean | null;
  rangeAdvantage: "herói" | "vilão" | "disputado" | "indeterminado";
  nutAdvantage: "herói" | "vilão" | "disputado" | "indeterminado";
  heroCapped: boolean | null;
  /** SRP | 3BP | 4BP+ quando derivável do histórico pré-flop; null quando não confirmado. */
  potType: "SRP" | "3BP" | "4BP+" | null;
  notes: string[];
};

export type ValueBluffRead = {
  /** strong value | thin value | showdown value | bluff catcher | semi-bluff | bluff puro | sem candidatura */
  status:
    | "strong value"
    | "thin value"
    | "showdown value"
    | "bluff catcher"
    | "semi-bluff"
    | "bluff puro"
    | "indeterminado";
  questions: string[];
};

export type PostflopAnalysis = {
  street: StreetName | "analisando";
  /** true quando a street não pôde ser derivada do board confirmado. */
  inconsistentBoard: boolean;
  handCode: string | null;
  /** Cartas CONFIRMADAS (rótulos normalizados), como o motor as leu. Só leitura. */
  cards: { hero: string[]; board: string[] };
  texture: BoardTexture | null;
  strength: HandStrengthRead | null;
  line: HandLine;
  math: PostflopMath;
  range: RangeContext;
  valueBluff: ValueBluffRead;
  legalActions: string[];
  /** Só true com evidência textual/botão real de all-in. */
  allInEvidence: boolean;
  /** Confiança ESTRATÉGICA (não é a confiança visual do OCR). */
  strategicConfidence: "alta" | "media" | "baixa";
  missing: string[];
  /** Bloco pronto para o prompt. Determinístico; a IA não recalcula nada disto. */
  promptBlock: string;
};

const pct = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);

const positionIsIP = (heroPosition: string | null | undefined, line: HandLine): boolean | null => {
  const pos = (heroPosition ?? "").trim().toUpperCase();
  if (!pos) return null;
  // Algumas fontes já publicam a posição relativa pronta.
  if (pos === "IP") return true;
  if (pos === "OOP") return false;
  const ORDER = ["SB", "BB", "UTG", "HJ", "MP", "LJ", "CO", "BTN", "BU"];
  const villain = line.preflopAggressor && line.preflopAggressor !== pos ? line.preflopAggressor : null;
  if (!villain) return null;
  const rank = (p: string) => ORDER.indexOf(p === "BU" ? "BTN" : p === "MP" || p === "LJ" ? "HJ" : p);
  const h = rank(pos);
  const v = rank(villain);
  if (h < 0 || v < 0) return null;
  return h > v;
};

export const analyzePostflop = (input: PostflopInput): PostflopAnalysis => {
  const board = parseCards(input.board);
  const hole = parseCards(input.heroCards);
  const declared = streetFromBoard(board.length);
  const inconsistentBoard =
    declared === "analisando" || (input.board ?? []).filter(Boolean).length !== board.length;
  const street: StreetName | "analisando" = inconsistentBoard ? "analisando" : declared;

  const texture = board.length >= 3 ? classifyBoard(board) : null;
  const strength =
    !inconsistentBoard && board.length >= 3 ? readHandStrength(input.heroCards, input.board) : null;
  const line = parseHandLine(input.actionHistory, street === "analisando" ? null : street);
  const legalActions = normalizeActions(input.legalActions ?? []);

  // ---------- matemática determinística (nada estimado pela IA) ----------
  const odds = potOdds(input.pot ?? null, input.toCall ?? null);
  const eff = effectiveStackChips(input.heroStack, input.effectiveStack);
  const sprRead = spr(input.pot ?? null, eff);
  const potChips = parseChips(input.pot ?? null);
  const callChips = parseChips(input.toCall ?? null);
  const cleanOuts = strength?.outs?.cleanOuts ?? null;
  const equity =
    street === "flop" || street === "turn"
      ? (cleanOuts ? outsEquity(cleanOuts, street)?.equity ?? null : null)
      : null; // river: não existe carta por vir
  const bc = bluffCatchBreakeven(input.pot ?? null, input.toCall ?? null);

  const math: PostflopMath = {
    potChips,
    callChips,
    requiredEquity: odds?.requiredEquity ?? null,
    betPctOfPot: potChips && callChips ? pct((callChips / potChips) * 100) : null,
    effectiveStackChips: eff,
    effectiveDepthBB: effectiveDepthBB(eff, input.blinds),
    spr: sprRead?.spr ?? null,
    sprRegime: sprRead?.regime ?? null,
    cleanOuts,
    drawEquity: equity,
    foldEquityNeeded: foldEquityNeeded(input.pot ?? null, input.toCall ?? null),
    mdf: minDefenseFrequency(input.pot ?? null, input.toCall ?? null),
    bluffCatchNeedBluffPct: bc?.needBluffPct ?? null,
  };

  // ---------- contexto de range ----------
  const heroPos = (input.heroPosition ?? "").trim().toUpperCase() || null;
  const playersInHand = input.activePlayers ?? line.playersSeenPostflop ?? null;
  const multiway = (playersInHand ?? 0) > 2;
  const heroIsPFA =
    input.heroIsPreflopAggressor ??
    (heroPos && line.preflopAggressor ? line.preflopAggressor === heroPos : null);
  const ip = input.heroInPosition ?? positionIsIP(heroPos, line);

  const notes: string[] = [];
  let rangeAdvantage: RangeContext["rangeAdvantage"] = "indeterminado";
  let nutAdvantage: RangeContext["nutAdvantage"] = "indeterminado";
  let heroCapped: boolean | null = null;

  if (texture && heroIsPFA != null) {
    const highBoard = texture.profile === "broadway-heavy" || texture.highCard >= 12;
    rangeAdvantage = heroIsPFA ? (highBoard ? "herói" : "disputado") : highBoard ? "vilão" : "disputado";
    nutAdvantage = texture.profile === "low-card" && !heroIsPFA ? "disputado" : rangeAdvantage;
    heroCapped = heroIsPFA === false && !!line.byStreet.preflop.some((a) => a.action === "CALL");
    notes.push(
      heroIsPFA
        ? "Herói foi o agressor pré-flop: o range dele contém overpairs e broadways que o caller normalmente 3-betaria ou foldaria."
        : "Herói foi o caller pré-flop: range mais capped em mãos muito fortes, mais concentrado em pares médios, suited connectors e broadways sem 3-bet.",
    );
  } else {
    notes.push("Agressor pré-flop não confirmado: não assuma iniciativa; trate range advantage como indeterminado.");
  }
  if (multiway)
    notes.push(
      "Pote MULTIWAY: value range mais forte, menos blefe, menos fold equity, bluff catchers piores, nut potential mais importante. Top pair perde força relativa.",
    );
  if (street === "river")
    notes.push("River: o range do vilão é o 'arrive range' — só o que chegou até aqui depois de toda a linha.");

  const preflopRaises = line.byStreet.preflop.filter((a) => a.action === "RAISE" || a.action === "ALLIN").length;
  const potType: RangeContext["potType"] =
    input.potType ?? (!line.byStreet.preflop.length ? null : preflopRaises >= 3 ? "4BP+" : preflopRaises === 2 ? "3BP" : "SRP");
  if (potType === "3BP" || potType === "4BP+")
    notes.push(
      "Pote de 3-bet ou maior: ranges mais estreitos e polarizados, SPR menor, mãos fortes se comprometem mais rápido e blefes baratos perdem espaço.",
    );

  const range: RangeContext = {
    heroIsPreflopAggressor: heroIsPFA,
    villainIsPreflopAggressor: heroIsPFA == null ? null : !heroIsPFA,
    multiway,
    playersInHand,
    heroInPosition: ip,
    rangeAdvantage,
    nutAdvantage,
    heroCapped,
    potType,
    notes,
  };

  // ---------- value / bluff ----------
  const questions: string[] = [];
  let status: ValueBluffRead["status"] = "indeterminado";
  if (strength) {
    const s = strength.madeHand.strength;
    const hasDraw = strength.draws.flushDraw || strength.draws.oesd || strength.draws.doubleGutter || strength.draws.comboDraw;
    if (s === "nuts ou quase nuts") status = "strong value";
    else if (s === "mão forte") status = "strong value";
    else if (s === "mão média / showdown value")
      // Multiway uma mão média deixa de ser candidata a value fino: vira showdown value.
      status = multiway ? "showdown value" : "thin value";
    else if (s === "bluff catcher") status = "bluff catcher";
    else status = street !== "river" && hasDraw ? "semi-bluff" : "bluff puro";

    if (status === "strong value" || status === "thin value")
      questions.push("Quais mãos PIORES realisticamente pagam esta aposta? Se quase nenhuma continua, não é value.");
    if (status === "bluff catcher" || status === "showdown value")
      questions.push(
        `Contra este sizing o vilão precisa estar blefando ≥ ${math.bluffCatchNeedBluffPct ?? "?"}% para o call empatar. O range dele blefa tanto assim nesta linha?`,
      );
    if (status === "semi-bluff")
      questions.push("Semi-blefe: existe fold equity AGORA e equity futura com outs limpos? Ambas precisam existir.");
    if (status === "bluff puro")
      questions.push(
        "Blefe puro: quais mãos MELHORES foldam? Os blockers bloqueiam folds ou desbloqueiam calls? Quantos jogadores precisam foldar?",
      );
    if (street === "river")
      questions.push("River: não existe draw futuro. A mão vale exatamente o que é no showdown.");
    if (multiway && (status === "bluff puro" || status === "semi-bluff"))
      questions.push("Multiway reduz fold equity: cada jogador extra derruba a viabilidade do blefe.");
  }

  // ---------- confiança estratégica ----------
  const missing: string[] = [];
  if (inconsistentBoard) missing.push("board inconsistente (street não derivável)");
  if (!heroPos) missing.push("posição do herói");
  if (!line.actions.length) missing.push("histórico de ações");
  if (potChips == null) missing.push("pote atual");
  if (eff == null) missing.push("stack efetivo");
  if (!legalActions.length) missing.push("ações legais visíveis");
  if (playersInHand == null) missing.push("número de jogadores na mão");

  const strategicConfidence: PostflopAnalysis["strategicConfidence"] =
    missing.length === 0 ? "alta" : missing.length <= 2 ? "media" : "baixa";

  const allInEvidence = line.allInEvidence || legalActions.includes("ALLIN");

  // ---------- bloco de prompt ----------
  const L: string[] = [];
  L.push(
    `STREET ATUAL (derivada de ${board.length} cartas comunitárias confirmadas): ${street.toUpperCase()}. Decisão NOVA: não carregue outs, draws, classificação nem recomendação da street anterior.`,
  );
  if (inconsistentBoard)
    L.push(
      "BOARD INCONSISTENTE: não afirme street nenhuma. Responda ANALISANDO e peça o que falta; nunca invente cartas.",
    );
  if (strength) {
    const m = strength.madeHand;
    L.push(
      `MÃO DO HERÓI: ${input.heroCards.filter(Boolean).join(" ")} — ${m.made.category}${m.detail && m.detail !== m.made.category ? ` (${m.detail})` : ""}; força relativa: ${m.strength}${m.playingTheBoard ? "; ATENÇÃO: o herói está jogando o board" : ""}.`,
    );
    L.push(`DRAWS AGORA: ${strength.draws.labels.join(", ")}.`);
    if (strength.outs)
      L.push(`OUTS: ${strength.outs.note}${math.drawEquity != null ? ` Equity aproximada: ${math.drawEquity}%.` : ""}`);
    else L.push("OUTS: river — não existe carta por vir, nenhum out pode ser contado.");
    if (strength.blockers.labels.length) L.push(`BLOCKERS: ${strength.blockers.labels.join("; ")}.`);
  }
  if (texture) L.push(`TEXTURA DO BOARD: ${texture.text}`);
  if (line.text) L.push(`LINHA DA MÃO (como o pote chegou aqui):\n${line.text}`);
  else L.push("LINHA DA MÃO NÃO LIDA: não invente ação anterior; declare a premissa e reduza a confiança.");
  const mathLines = [
    math.potChips != null ? `pote atual ${math.potChips}` : null,
    math.callChips != null ? `para pagar ${math.callChips}` : null,
    math.betPctOfPot != null ? `aposta ≈ ${math.betPctOfPot}% do pote` : null,
    math.requiredEquity != null ? `equity necessária ${math.requiredEquity}%` : null,
    math.spr != null ? `SPR ${math.spr} (${math.sprRegime})` : null,
    math.effectiveDepthBB != null ? `stack efetivo ~${math.effectiveDepthBB}bb` : null,
    math.drawEquity != null ? `equity do draw ${math.drawEquity}%` : null,
    math.foldEquityNeeded != null ? `fold equity necessária ${math.foldEquityNeeded}%` : null,
    math.mdf != null ? `MDF ${math.mdf}%` : null,
    math.bluffCatchNeedBluffPct != null ? `blefe mínimo do vilão ${math.bluffCatchNeedBluffPct}%` : null,
  ].filter(Boolean);
  if (mathLines.length)
    L.push(`MATEMÁTICA JÁ CALCULADA (use estes números, não recalcule): ${mathLines.join("; ")}.`);
  L.push(
    `RANGE VS RANGE: range advantage ${range.rangeAdvantage}; nut advantage ${range.nutAdvantage}; herói ${range.heroCapped ? "capped" : range.heroCapped === false ? "uncapped" : "capped/uncapped indeterminado"}; ${range.multiway ? "MULTIWAY" : "heads-up"}${range.heroInPosition == null ? "" : range.heroInPosition ? "; herói IP" : "; herói OOP"}. ${range.notes.join(" ")}`,
  );
  if (status !== "indeterminado")
    L.push(`CANDIDATURA DA MÃO: ${status.toUpperCase()}. ${questions.join(" ")}`);
  L.push(
    legalActions.length
      ? `AÇÕES LEGAIS AGORA: ${legalActions.join(" | ")}. Recomende SOMENTE uma destas.${legalActions.includes("ALLIN") ? "" : " Não existe botão de all-in: é proibido dizer que o herói enfrenta ou pode dar shove."}`
      : "AÇÕES LEGAIS NÃO LIDAS: não afirme que existe all-in nem qualquer botão específico.",
  );
  if (!allInEvidence)
    L.push("SEM EVIDÊNCIA DE ALL-IN: nenhuma frase pode descrever all-in, shove ou stack inteiro em jogo.");
  L.push(
    `CONFIANÇA ESTRATÉGICA: ${strategicConfidence}${missing.length ? ` — falta: ${missing.join(", ")}` : ""}. Confiança visual das cartas é assunto separado: cartas nítidas não tornam a decisão certa.`,
  );
  if (input.showdownCards?.length)
    L.push(
      "SHOWDOWN: cartas reveladas servem apenas para análise POSTERIOR do range do vilão. É proibido justificar a recomendação com a carta revelada; a pergunta é se a decisão era +EV contra o range plausível ANTES da revelação.",
    );
  L.push(
    "RESULTADO NÃO DEFINE QUALIDADE: avalie EV e ranges, nunca o fato de a mão ter ganho ou perdido.",
  );
  L.push(
    "TEORIA vs EXPLOIT: comece pelo baseline fundamental. Ajuste de população só entra rotulado como TENDÊNCIA DE POPULAÇÃO, nunca como fato. Exploit específico de jogador exige read confirmado — uma mão observada não define um vilão.",
  );
  L.push(
    "ESTILO: nem nit nem maníaco. Thin value, blefe, semi-blefe, c-bet atrasada, check-raise, bluff catch, proteção e negação de equity são todos permitidos quando o contexto sustenta — e só quando sustenta.",
  );
  L.push(
    "FORMATO DA DECISÃO: ação recomendada (uma das ações legais) + confiança + motivo curto + a matemática já fornecida + premissa de range assumida + o que mudaria a decisão. Inclua a alternativa próxima quando ela for realmente próxima.",
  );

  return {
    street,
    inconsistentBoard,
    handCode: holeCode(hole),
    cards: { hero: hole.map((c) => c.label), board: board.map((c) => c.label) },
    texture,
    strength,
    line,
    math,
    range,
    valueBluff: { status, questions },
    legalActions,
    allInEvidence,
    strategicConfidence,
    missing,
    promptBlock: L.join("\n"),
  };
};
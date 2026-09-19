/**
 * SAÍDA SIMPLES — converte a análise pós-flop (determinística) em UMA decisão principal.
 *
 * Camada de VALIDAÇÃO/estudo: não altera a arquitetura pós-flop nem os prompts. Serve para
 * provar que, por trás de todo o contexto, a saída continua simples e sempre legal.
 *
 * Vocabulário permitido: DESISTIR | PASSAR | PAGAR | APOSTAR X% | AUMENTAR | ALL-IN |
 * ESTRATÉGIA MISTA | ANALISANDO (quando o estado não permite recomendar).
 */
import type { PostflopAnalysis } from "./postflop";

export type MainAction =
  | "DESISTIR"
  | "PASSAR"
  | "PAGAR"
  | "APOSTAR"
  | "AUMENTAR"
  | "ALL-IN"
  | "ESTRATÉGIA MISTA"
  | "ANALISANDO";

export type DecisionSource =
  | "MATEMÁTICA"
  | "MATEMÁTICA + APROXIMAÇÃO PROFISSIONAL"
  | "APROXIMAÇÃO PROFISSIONAL"
  | "ESTADO INSUFICIENTE";

export type MainDecision = {
  action: MainAction;
  sizingPct: number | null;
  /** Texto curto exibível: "APOSTAR 33%", "PAGAR", "ESTRATÉGIA MISTA: PAGAR / DESISTIR". */
  label: string;
  confidence: "alta" | "media" | "baixa";
  source: DecisionSource;
  reason: string;
  alternative: string | null;
};

const has = (la: string[], a: string) => la.includes(a);

/** Margem de decisão próxima: diferença de equity (pp) que não justifica cravar um lado. */
const CLOSE_PP = 3;

/**
 * Calibração v2 (development set externo de 1.000 spots, holdout separado):
 *  - alta  → só onde a decisão é dominada por matemática com folga (fold caro, call barato claro);
 *  - media → linha padrão de aproximação profissional;
 *  - baixa → nós genuinamente mistos, estado incompleto ou leitura de range dominante.
 */
export const mainDecision = (a: PostflopAnalysis): MainDecision => {
  const la = a.legalActions;
  const stateConf = a.strategicConfidence;

  if (a.street === "analisando" || !a.strength)
    return {
      action: "ANALISANDO",
      sizingPct: null,
      label: "ANALISANDO",
      confidence: "baixa",
      source: "ESTADO INSUFICIENTE",
      reason: a.inconsistentBoard
        ? "Board inconsistente: a street não pode ser derivada das cartas confirmadas."
        : `Estado incompleto: falta ${a.missing.join(", ") || "informação confirmada"}.`,
      alternative: null,
    };

  const status = a.valueBluff.status;
  const req = a.math.requiredEquity;
  const eq = a.math.drawEquity;
  const multiway = a.range.multiway;
  const wet = a.texture?.wetness === "wet";
  const street = a.street;
  const river = street === "river";
  const threeBet = a.range.potType === "3BP" || a.range.potType === "4BP+";
  const nutty = a.strength.madeHand.strength === "nuts ou quase nuts";
  const category = a.strength.madeHand.made.category;
  /** Bluff catcher de UM par: o pior catcher possível — perde para todo o range de value. */
  const onePairOnly = category === "par" || category === "carta alta";
  const callChips = a.math.callChips ?? 0;
  const facing = callChips > 0 || (has(la, "FOLD") && (has(la, "CALL") || has(la, "ALLIN")));


  const out = (
    action: MainAction,
    reason: string,
    source: DecisionSource,
    confidence: MainDecision["confidence"],
    sizingPct: number | null = null,
    alternative: string | null = null,
    label?: string,
  ): MainDecision => ({
    action,
    sizingPct,
    label: label ?? (sizingPct != null ? `${action} ${sizingPct}%` : action),
    // A confiança nunca pode superar a confiança de estado: sem estado completo não há certeza.
    confidence: stateConf === "baixa" ? "baixa" : stateConf === "media" && confidence === "alta" ? "media" : confidence,
    source,
    reason,
    alternative,
  });

  if (!la.length)
    return {
      action: "ANALISANDO",
      sizingPct: null,
      label: "ANALISANDO",
      confidence: "baixa",
      source: "ESTADO INSUFICIENTE",
      reason: "Os botões da mesa não foram confirmados: nenhuma ação pode ser recomendada.",
      alternative: null,
    };

  if (facing) {
    const allInSpot = has(la, "ALLIN") && !has(la, "CALL");
    const raiseOk = has(la, "RAISE");
    const mixRaiseCall = (reason: string) =>
      raiseOk
        ? out("ESTRATÉGIA MISTA", reason, "APROXIMAÇÃO PROFISSIONAL", "baixa", null, null, "ESTRATÉGIA MISTA: AUMENTAR / PAGAR")
        : out(allInSpot ? "ALL-IN" : "PAGAR", reason, "APROXIMAÇÃO PROFISSIONAL", "media");

    if (status === "strong value") {
      // Pote de 3-bet: SPR baixo e range condensado. No flop o stack já está comprometido e
      // aumentar é o padrão; do turn em diante aumentar e pagar dividem o EV porque o range
      // do 3-bettor contém overpairs suficientes para pagar depois.
      if (threeBet && raiseOk && street === "flop" && (req == null || req >= 20))
        return out(
          "AUMENTAR",
          "Flop de pote de 3-bet com mão forte: SPR baixo, o dinheiro entra agora e o range condensado do vilão paga mais largo.",
          "APROXIMAÇÃO PROFISSIONAL",
          "media",
          null,
          "PAGAR",
        );
      if (threeBet && raiseOk)
        return mixRaiseCall(
          "Pote de 3-bet com mão forte: aumentar compromete o stack com value claro, pagar mantém no range do vilão as overpairs e os blefes que continuariam apostando — EV próximo.",
        );

      // River com mão forte mas não nuts: nó de indiferença entre value raise fino e bluff catch forte.
      if (river && !nutty)
        return mixRaiseCall(
          "River com mão forte porém não nuts: aumentar é value fino contra um range que ainda paga, pagar evita ser pago só por melhores — EV próximo.",
        );
      if (river)
        return mixRaiseCall(
          "River com mão muito forte: aumentar extrai de um range que ainda paga, pagar mantém os blefes do vilão dentro do pote — EV próximo.",
        );
      // Pote simples fora do river: com ruas por vir, aumentar cobra apenas as melhores e
      // esvazia o range de blefe do vilão. Pagar mantém o range dele largo e permite
      // extrair nas ruas seguintes — o value máximo de uma mão forte não é imediato.
      return out(
        "PAGAR",
        "Pote simples com mão forte e ruas por vir: aumentar agora espanta os blefes e só é pago por melhores — pagar mantém o range do vilão largo e extrai mais nas ruas seguintes.",
        "APROXIMAÇÃO PROFISSIONAL",
        "media",
        null,
        raiseOk ? "AUMENTAR por value/proteção em board muito dinâmico" : null,
      );
    }


    if (status === "semi-bluff") {
      if (eq != null && req != null && eq < req - 10)
        return out(
          "ESTRATÉGIA MISTA",
          `Equity do draw ${eq}% bem abaixo da necessária ${req}%: pagar só se sobrarem implied odds.`,
          "MATEMÁTICA",
          "baixa",
          null,
          null,
          "ESTRATÉGIA MISTA: PAGAR / DESISTIR",
        );
      return out(
        "PAGAR",
        eq != null && req != null
          ? `Draw vivo: equity ${eq}% contra equity necessária ${req}%, com equity futura e implied odds.`
          : "Draw vivo contra aposta: continuar é o padrão.",
        eq != null && req != null ? "MATEMÁTICA" : "APROXIMAÇÃO PROFISSIONAL",
        // Só há evidência forte quando a equity do draw supera a necessária com folga real.
        eq != null && req != null && eq - req > 15 ? "alta" : "media",
        null,
        has(la, "RAISE") ? "AUMENTAR (semi-blefe)" : null,
      );
    }

    if (status === "thin value" && threeBet && raiseOk && !river)
      return out(
        "ESTRATÉGIA MISTA",
        "Pote de 3-bet com mão média contra aposta: SPR baixo e range estreito deixam aumentar e pagar praticamente indiferentes.",
        "APROXIMAÇÃO PROFISSIONAL",
        "media",
        null,
        null,
        "ESTRATÉGIA MISTA: AUMENTAR / PAGAR",
      );

    if (status === "thin value" || status === "showdown value" || status === "bluff catcher") {
      if (req == null)
        return out("PAGAR", "Sem preço confirmado: mão de showdown paga por padrão.", "APROXIMAÇÃO PROFISSIONAL", "baixa");
      if (multiway && status !== "thin value")
        return out(
          "DESISTIR",
          `Multiway: bluff catcher perde valor e a equity necessária é ${req}%.`,
          "MATEMÁTICA + APROXIMAÇÃO PROFISSIONAL",
          "media",
        );
      // Flop: o range do vilão ainda é largo e a mão pode melhorar — o preço domina.
      if (street === "flop")
        return out(
          "PAGAR",
          `Flop com showdown value (equity necessária ${req}%): o range que aposta aqui ainda é largo e restam duas cartas — desistir cedo entrega equity e blefes.`,
          "MATEMÁTICA + APROXIMAÇÃO PROFISSIONAL",
          "media",
        );

      // Pote de 3-bet fora do river: SPR baixo, range condensado e polarizado ao mesmo tempo.
      // Pagar, desistir e até aumentar por proteção ficam genuinamente indiferentes.
      if (threeBet && !river && status === "bluff catcher")
        return out(
          "ESTRATÉGIA MISTA",
          `Pote de 3-bet com bluff catcher (equity necessária ${req}%): com SPR baixo o vilão tem overpairs demais para pagar barato e blefes demais para desistir sempre — o nó é indiferente.`,
          "MATEMÁTICA + APROXIMAÇÃO PROFISSIONAL",
          "baixa",
          null,
          raiseOk ? "AUMENTAR por proteção" : null,
          "ESTRATÉGIA MISTA: PAGAR / DESISTIR",
        );

      // Dois pares ou melhor não é o pior catcher: bate blefes E value fino do vilão.
      const strongCatcher = !onePairOnly || status === "thin value";
      if (strongCatcher) {
        if (river && status !== "thin value" && req >= 20)
          return out(
            "ESTRATÉGIA MISTA",
            `River com mão acima de um par contra aposta (equity necessária ${req}%): no river o range do vilão já chegou — desistir contra polarização, pagar contra blefe e até aumentar por value fino ficam próximos.`,
            "MATEMÁTICA + APROXIMAÇÃO PROFISSIONAL",
            "baixa",
            null,
            raiseOk ? "AUMENTAR por value fino" : null,
            "ESTRATÉGIA MISTA: PAGAR / DESISTIR",
          );

        return out(
          "PAGAR",
          `Mão de showdown acima de um par (equity necessária ${req}%): bate os blefes e ainda bate parte do value fino do vilão.`,
          "MATEMÁTICA + APROXIMAÇÃO PROFISSIONAL",
          "media",
        );
      }

      // Bluff catcher de UM par: só o preço sustenta o call — e só quando é barato.
      if (req < 20)
        return out(
          "PAGAR",
          `Preço barato (equity necessária ${req}%): mesmo um par isolado bate blefes suficientes para pagar.`,
          "MATEMÁTICA",
          "media",
        );
      if (!river && req < 25 && !threeBet)
        return out(
          "ESTRATÉGIA MISTA",
          `Turn com um par isolado e preço barato (equity necessária ${req}%): pagar protege contra o blefe, desistir evita pagar duas ruas contra value.`,
          "MATEMÁTICA + APROXIMAÇÃO PROFISSIONAL",
          "baixa",
          null,
          null,
          "ESTRATÉGIA MISTA: PAGAR / DESISTIR",
        );
      return out(
        "DESISTIR",
        `Um par isolado contra equity necessária ${req}%: quem aposta esse tamanho com duas/uma rua de value já bate a mão — não há blefe suficiente.`,
        "MATEMÁTICA + APROXIMAÇÃO PROFISSIONAL",
        // Fold de bluff catcher é leitura de range, não conta fechada: nunca confiança alta.
        "media",
      );
    }

    // ----- blefe puro contra aposta -----
    // Pote de 3-bet: SPR baixo e range condensado. Pagar é a pior opção — ou o blefe por
    // aumento tem fold equity real, ou a mão não continua.
    if (threeBet && raiseOk && !river && req != null && req < 25)
      return out(
        "ESTRATÉGIA MISTA",
        `Pote de 3-bet sem mão feita: pagar é a pior opção com SPR baixo — ou o aumento como blefe tem fold equity contra um range condensado (equity necessária ${req}%), ou a mão desiste.`,
        "APROXIMAÇÃO PROFISSIONAL",
        "baixa",
        null,
        null,
        "ESTRATÉGIA MISTA: AUMENTAR / DESISTIR",
      );
    if (street === "flop" && !threeBet && req != null && req < 25)
      return out(
        "PAGAR",
        `Flop barato em pote simples (equity necessária ${req}%): backdoors, overcards e a chance de o vilão desistir depois justificam um call flutuante.`,
        "MATEMÁTICA + APROXIMAÇÃO PROFISSIONAL",
        "baixa",
      );

    return out(
      "DESISTIR",
      req != null
        ? `Sem mão e sem draw vivo contra equity necessária ${req}%: não existe blefe de call.`
        : "Sem mão, sem draw vivo e sem preço: blefar de call não existe.",
      req != null ? "MATEMÁTICA" : "APROXIMAÇÃO PROFISSIONAL",
      req != null && req >= 27 && (river || street === "turn") ? "alta" : "media",
    );

  }

  // ----- sem aposta na frente (CHECK / BET) -----
  const canBet = has(la, "BET") || has(la, "RAISE");
  if (!canBet) return out("PASSAR", "Única ação disponível é passar.", "APROXIMAÇÃO PROFISSIONAL", "media");

  if (status === "strong value") {
    // Sem nut advantage, apostar de primeira OOP vira um convite ao aumento: a mão forte
    // porém vulnerável a ser superada prefere proteger o próprio range de check.
    if (!nutty && (wet || category === "dois pares"))
      return out(
        "PASSAR",
        wet
          ? "Mão forte mas não nuts em board dinâmico e fora de posição: apostar só é pago por melhores e abre espaço para aumento — passar protege o range de check e mantém os blefes do vilão."
          : "Dois pares fora de posição: apostar espanta as mãos piores e transforma a mão em bluff catcher caro se vier aumento — passar mantém o pote controlado e induz blefe.",
        "APROXIMAÇÃO PROFISSIONAL",
        "media",
        null,
        "APOSTAR 33% fino",
      );
    if (!nutty)
      return out(
        "ESTRATÉGIA MISTA",
        "Mão forte não-nuts: apostar extrai value imediato, passar induz o blefe do vilão — EV próximo.",
        "APROXIMAÇÃO PROFISSIONAL",
        "baixa",
        null,
        null,
        "ESTRATÉGIA MISTA: APOSTAR 66% / PASSAR",
      );
    return out(
      "APOSTAR",
      "Nuts ou quase nuts: existe nut advantage claro — value máximo, com sizing maior em board dinâmico.",
      "APROXIMAÇÃO PROFISSIONAL",
      "media",
      wet ? 75 : 66,
      "PASSAR para induzir",
    );
  }

  if (status === "thin value")
    return out(
      "PASSAR",
      "Value fino sem aposta na frente: apostar só é pago por melhores e transforma a mão em blefe — controlar o pote captura mais EV.",
      "APROXIMAÇÃO PROFISSIONAL",
      "media",
      null,
      "APOSTAR 33% fino",
    );
  if (status === "showdown value")
    return out(
      "PASSAR",
      multiway ? "Multiway com mão média: showdown value, não value bet." : "Mão média: controlar pote e chegar ao showdown.",
      "APROXIMAÇÃO PROFISSIONAL",
      "media",
      null,
      "APOSTAR 25% como bloqueio",
    );
  if (status === "bluff catcher")
    return out(
      "PASSAR",
      "Bluff catcher não aposta: só paga quando o preço permite.",
      "APROXIMAÇÃO PROFISSIONAL",
      "media",
    );
  if (status === "semi-bluff") {
    if (multiway)
      return out("PASSAR", "Multiway derruba a fold equity do semi-blefe.", "APROXIMAÇÃO PROFISSIONAL", "media");
    if (street === "flop")
      return out("APOSTAR", "Semi-blefe no flop: fold equity alta e equity futura.", "APROXIMAÇÃO PROFISSIONAL", "media", 50, "PASSAR");
    return out(
      "ESTRATÉGIA MISTA",
      "Semi-blefe no turn: apostar e passar ficam próximos — o draw realiza equity de graça no check.",
      "APROXIMAÇÃO PROFISSIONAL",
      "baixa",
      null,
      null,
      "ESTRATÉGIA MISTA: APOSTAR 50% / PASSAR",
    );
  }

  // bluff puro
  if (multiway) return out("PASSAR", "Blefe puro multiway: fold equity insuficiente.", "APROXIMAÇÃO PROFISSIONAL", "media");
  // River sem mão: é exatamente aqui que existe o nó polarizado — a mão não ganha showdown
  // nenhum, então apostar não perde value e o check só vence se o vilão também desistir de apostar.
  if (river)
    return out(
      "ESTRATÉGIA MISTA",
      a.strength.blockers.labels.length
        ? "River sem mão, mas com blockers relevantes: a mão não tem showdown value, então blefar e passar têm EV próximo."
        : "River sem showdown value: como a mão nunca ganha passada, blefar com um sizing polarizado e passar ficam próximos — a frequência depende dos blockers e do range do vilão.",
      "APROXIMAÇÃO PROFISSIONAL",
      "baixa",
      null,
      null,
      "ESTRATÉGIA MISTA: APOSTAR 66% / PASSAR",
    );

  return out(
    "PASSAR",
    "Sem mão, sem draw e sem blocker: check grátis.",
    "APROXIMAÇÃO PROFISSIONAL",
    river ? "media" : "baixa",
  );
};

/** A decisão simples sempre tem de caber nos botões reais da mesa. */
export const decisionIsLegal = (d: MainDecision, legalActions: string[]): boolean => {
  const la = legalActions;
  const facing = la.includes("CALL");
  switch (d.action) {
    case "ANALISANDO":
      return true;
    case "DESISTIR":
      return la.includes("FOLD");
    case "PASSAR":
      return la.includes("CHECK") || !la.length;
    case "PAGAR":
      return la.includes("CALL") || la.some((a) => a.startsWith("CALL"));
    case "APOSTAR":
      // Algumas mesas rotulam a aposta inicial como "RAISE" quando não há aposta pendente.
      return la.includes("BET") || (!facing && la.includes("RAISE"));
    case "AUMENTAR":
      return la.includes("RAISE");
    case "ALL-IN":
      return la.includes("ALLIN");
    case "ESTRATÉGIA MISTA":
      return la.length > 1;
  }
};
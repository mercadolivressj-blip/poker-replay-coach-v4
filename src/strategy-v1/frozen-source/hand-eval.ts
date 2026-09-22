/**
 * Avaliação estrutural instantânea das duas cartas do herói.
 * Local, sem IA: assim que o Hero é confirmado, já dá para descrever a mão.
 * Não é decisão — é leitura da mão.
 */

const ORDER = "23456789TJQKA";
const NAME: Record<string, string> = {
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  T: "10",
  J: "valete",
  Q: "dama",
  K: "rei",
  A: "ás",
};

export type HandEval = {
  label: string; // "A5s", "KK"
  category: string; // Premium, Forte, Jogável, Especulativa, Fraca
  structure: string; // par / suited / offsuit + conectividade
  potential: string; // nuts, flush, sequência
  playability: string; // jogabilidade / dominância
};

export function evaluateHoleCards(cards: string[]): HandEval | null {
  if (cards.length !== 2) return null;
  const a = cards[0]!.trim();
  const b = cards[1]!.trim();
  const r1 = a[0]!.toUpperCase();
  const r2 = b[0]!.toUpperCase();
  const s1 = a.slice(1).toLowerCase();
  const s2 = b.slice(1).toLowerCase();
  const i1 = ORDER.indexOf(r1);
  const i2 = ORDER.indexOf(r2);
  if (i1 < 0 || i2 < 0) return null;

  const hi = Math.max(i1, i2);
  const lo = Math.min(i1, i2);
  const hiR = ORDER[hi]!;
  const loR = ORDER[lo]!;
  const pair = i1 === i2;
  const suited = s1 === s2 && s1 !== "";
  const gap = hi - lo; // 1 = conectada
  const label = pair ? `${hiR}${hiR}` : `${hiR}${loR}${suited ? "s" : "o"}`;

  // ---- estrutura ----
  let structure: string;
  if (pair) {
    structure = `Par de ${NAME[hiR]}s na mão — já é um par feito antes do flop.`;
  } else {
    const conn =
      gap === 1
        ? "cartas coladas (sequência fácil)"
        : gap === 2
          ? "um buraco de distância (sequência possível)"
          : gap === 3
            ? "dois buracos (sequência difícil)"
            : "cartas distantes (sequência improvável)";
    structure = `${NAME[hiR]} com ${NAME[loR]}, ${suited ? "do mesmo naipe" : "de naipes diferentes"} — ${conn}.`;
  }

  // ---- potencial ----
  const pots: string[] = [];
  if (pair) {
    pots.push("vira trinca em cerca de 1 flop a cada 8");
    if (hi >= ORDER.indexOf("T")) pots.push("já costuma estar na frente antes do flop");
  }
  if (suited) {
    pots.push(
      hiR === "A" ? "flush máximo (nuts) se vier o naipe" : "flush se vierem mais duas do naipe",
    );
  }
  if (!pair && gap <= 2 && lo >= ORDER.indexOf("4")) pots.push("sequência com as cartas do meio");
  if (!pair && hi >= ORDER.indexOf("T") && lo >= ORDER.indexOf("T"))
    pots.push("par alto quando acertar o flop");
  const potential = pots.length
    ? pots.join("; ") + "."
    : "pouco potencial de mão grande; depende muito do flop.";

  // ---- categoria ----
  const broadway = lo >= ORDER.indexOf("T");
  let score = 0;
  if (pair) score = hi >= ORDER.indexOf("T") ? 4 : hi >= ORDER.indexOf("7") ? 3 : 2;
  else {
    score = broadway
      ? 3
      : hi === ORDER.indexOf("A")
        ? 2
        : gap <= 1 && lo >= ORDER.indexOf("5")
          ? 2
          : 1;
    if (suited) score += 1;
  }
  const category =
    score >= 5
      ? "Premium"
      : score === 4
        ? "Forte"
        : score === 3
          ? "Jogável"
          : score === 2
            ? "Especulativa"
            : "Fraca";

  // ---- jogabilidade / dominância ----
  let playability: string;
  if (pair && hi >= ORDER.indexOf("J"))
    playability = "Fácil de jogar: geralmente é a melhor mão e aguenta pressão.";
  else if (pair)
    playability =
      "Joga bem barato: quer ver o flop e acertar trinca; para de pagar se vierem cartas altas.";
  else if (broadway)
    playability = suited
      ? "Boa jogabilidade: faz par alto e ainda tem projeto de flush."
      : "Cuidado com dominação: par alto pode perder para um kicker melhor.";
  else if (hi === ORDER.indexOf("A"))
    playability = suited
      ? "Vale por trás do ás: projeto de flush máximo, mas o par de ases fracos é dominado com frequência."
      : "Ás com carta baixa e naipes diferentes é frequentemente dominado — jogue barato.";
  else if (gap <= 1)
    playability = "Mão de projeto: quer flop barato e muitos jogadores; sozinha, vale pouco.";
  else playability = "Mão fraca: sem flop muito bom, não vale investir fichas.";

  return { label, category, structure, potential, playability };
}
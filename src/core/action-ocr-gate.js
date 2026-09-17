const A = (v) => String(v ?? '').trim().toUpperCase();
const statusNoise = (raw='') => /\b(ausente|lugar\s+vazio|venceu|ganhou\s+pote|sitting\s+out|empty\s+seat)\b/i.test(String(raw));

export function shouldAcceptOcrAction({action, confidence=0, cardPresent=false, raw=''}={}) {
  const a=A(action), c=Math.max(0,Math.min(1,Number(confidence)||0));
  // FOLD is owned by the proven card-back disappearance detector (V1.2).
  if(a==='FOLD') return {ok:false,reason:'fold-owned-by-card-detector'};
  // Opponent action text is only meaningful while that opponent still has card backs.
  // This rejects empty seats, sitting-out labels and showdown/result text.
  if(cardPresent!==true) return {ok:false,reason:'opponent-cards-not-present'};
  if(statusNoise(raw)) return {ok:false,reason:'status-or-result-text'};
  if(!['CHECK','CALL','BET','RAISE','ALLIN'].includes(a)) return {ok:false,reason:'unsupported-action'};
  // ALL-IN OCR is especially easy to hallucinate from short noisy plate text.
  const min = a==='ALLIN' ? .70 : .48;
  if(c<min) return {ok:false,reason:'ocr-confidence-too-low',minConfidence:min};
  return {ok:true,reason:'eligible',minConfidence:min};
}

export function ocrActionGateSummary(rows=[]) {
  const list=Array.isArray(rows)?rows:[];
  return {accepted:list.filter(x=>x?.ok).length,rejected:list.filter(x=>!x?.ok).length};
}

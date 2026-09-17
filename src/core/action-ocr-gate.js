const A = (v) => String(v ?? '').trim().toUpperCase();
const statusNoise = (raw='') => /\b(ausente|lugar\s+vazio|venceu|ganhou\s+pote|sitting\s+out|empty\s+seat)\b/i.test(String(raw));

export function shouldAcceptOcrAction({action, confidence=0, cardPresent=false, activeThisHand=null, folded=false, raw=''}={}) {
  const a=A(action), c=Math.max(0,Math.min(1,Number(confidence)||0));
  // FOLD is owned by the proven card-back disappearance detector (V1.2).
  if(a==='FOLD') return {ok:false,reason:'fold-owned-by-card-detector'};
  if(statusNoise(raw)) return {ok:false,reason:'status-or-result-text'};
  if(!['CHECK','CALL','BET','RAISE','ALLIN'].includes(a)) return {ok:false,reason:'unsupported-action'};
  // Production path: eligibility is hand-scoped. Once a seat was seen with cards,
  // it stays eligible until the fold detector marks it folded or the hand resets.
  if(activeThisHand!==null){
    if(folded===true)return {ok:false,reason:'seat-already-folded'};
    if(activeThisHand!==true)return {ok:false,reason:'seat-not-active-this-hand'};
  } else if(cardPresent!==true){
    // Backward-compatible fallback for older callers/tests.
    return {ok:false,reason:'opponent-cards-not-present'};
  }
  // ALL-IN OCR is especially easy to hallucinate from short noisy plate text.
  const min = a==='ALLIN' ? .74 : .48;
  if(c<min) return {ok:false,reason:'ocr-confidence-too-low',minConfidence:min};
  return {ok:true,reason:'eligible',minConfidence:min};
}

export function ocrActionGateSummary(rows=[]) {
  const list=Array.isArray(rows)?rows:[];
  return {accepted:list.filter(x=>x?.ok).length,rejected:list.filter(x=>!x?.ok).length};
}

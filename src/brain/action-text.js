const norm=(v)=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
const number=(text)=>{
  const m=String(text??'').match(/(?:US\$|R\$|\$|€|£)?\s*(\d+(?:[.,]\d+)?)/i);
  if(!m)return null;
  const n=Number(m[1].replace(',','.'));
  return Number.isFinite(n)?n:null;
};

export function parsePokerStarsActionText(raw){
  const text=norm(raw);
  if(!text)return null;
  let action=null;
  if(/\b(desisto|desiste|fold|folds)\b/.test(text))action='FOLD';
  else if(/\b(passo|passa|check|checks)\b/.test(text))action='CHECK';
  else if(/\b(pago|paga|call|calls|igualo|iguala)\b/.test(text))action='CALL';
  else if(/\b(aumento|aumenta|raise|raises|3-?bet)\b/.test(text))action='RAISE';
  else if(/\b(aposto|aposta|bet|bets)\b/.test(text))action='BET';
  else if(/\b(all[ -]?in|shove)\b/.test(text))action='ALLIN';
  if(!action)return null;
  return {version:'action-text-v1',action,amount:number(raw),raw:String(raw??'').trim(),normalized:text};
}

export function actionTextCandidate({actor=null,seatId=null,street='preflop',text='',at=Date.now(),confidence=.7,packetId=null}={}){
  const parsed=parsePokerStarsActionText(text);if(!parsed)return null;
  return {...parsed,type:'action-candidate',status:'provisional',sovereign:false,source:'local-action-text',actor:actor||null,seatId:seatId||null,street,capturedAt:at,confidence:Math.max(0,Math.min(1,Number(confidence)||0)),packetId:packetId||null};
}

import crypto from 'node:crypto';

const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const SUITS = ['clubs','diamonds','hearts','spades'];
const STREETS = ['preflop','flop','turn','river'];
const ACTIONS = ['fold','check','call','bet','raise','allin'];

function extractOutputText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  for (const item of response?.output || []) {
    for (const part of item?.content || []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') return part.text;
    }
  }
  return '';
}

function tokenMatches(expected, provided) {
  if (!expected) return true;
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(expected), b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a,b);
}

const cardSchema={type:'object',additionalProperties:false,properties:{rank:{type:'string',enum:RANKS},suit:{type:'string',enum:SUITS},confidence:{type:'number',minimum:0,maximum:1}},required:['rank','suit','confidence']};
function schema(){return {type:'object',additionalProperties:false,properties:{tableSize:{type:['integer','null'],enum:[2,3,4,5,6,7,8,9,10,null]},hero:{type:'array',minItems:0,maxItems:2,items:cardSchema},board:{type:'array',minItems:0,maxItems:5,items:cardSchema},pot:{type:['number','null'],minimum:0},street:{type:'string',enum:STREETS},heroToAct:{type:['boolean','null']},seats:{type:'array',maxItems:10,items:{type:'object',additionalProperties:false,properties:{seatIndex:{type:'integer',minimum:0,maximum:9},actorName:{type:['string','null'],maxLength:64},stack:{type:['number','null'],minimum:0},committed:{type:['number','null'],minimum:0},dealer:{type:'boolean'},folded:{type:['boolean','null']},hero:{type:'boolean'},visibleAction:{type:['string','null'],enum:[...ACTIONS,null]},visibleActionAmount:{type:['number','null'],minimum:0},confidence:{type:'number',minimum:0,maximum:1}},required:['seatIndex','actorName','stack','committed','dealer','folded','hero','visibleAction','visibleActionAmount','confidence']}},confidence:{type:'number',minimum:0,maximum:1},heroConfidence:{type:'number',minimum:0,maximum:1},boardConfidence:{type:'number',minimum:0,maximum:1},potConfidence:{type:'number',minimum:0,maximum:1},seatsConfidence:{type:'number',minimum:0,maximum:1}},required:['tableSize','hero','board','pot','street','heroToAct','seats','confidence','heroConfidence','boardConfidence','potConfidence','seatsConfidence']};}
function prompt(){return [
'Poker REPLAY / post-game study screenshot. Read visible public table state only. Never provide strategy.',
'Inspect the whole table image directly. Precision over coverage: use null/low confidence instead of guessing.',
'Hero hole cards are MANUAL-ONLY in this coach. Do NOT inspect, infer or return Hero hole cards. Always return hero=[] and heroConfidence=0. You may still identify which seat is Hero from the bottom/known Hero seat and set seats[].hero=true.',
'Before returning JSON, perform a COMPLETE CLOCKWISE PERIMETER SWEEP of the table starting at the top-most physical seat and continuing through every visible seat slot until you return to the start.',
'Do not skip a seat because its avatar overlaps, text is dim, the player folded, is away/disconnected, or the nickname is small. Do not merge adjacent seats into one.',
'After the sweep, verify that every visible occupied nickname around the rail appears exactly once in seats. If a readable nickname is visible but missing from your first pass, add it before answering.',
'tableSize means PHYSICAL TABLE CAPACITY / seat layout, not the number of currently active players. Infer it from the whole seat geometry. If the visible perimeter clearly contains 9 physical positions, do not return 8-max.',
'Board: return community cards left-to-right; length 0, 3, 4 or 5. Street must match board length.',
'Pot: read ONLY the central visible TEXT label beginning with "Pote:". It may be CASH ("Pote: US$ 0,12") or TOURNAMENT CHIPS ("Pote: 630", "Pote: 2.508").',
'CRITICAL POT DISAMBIGUATION: PokerStars often shows a separate chip-stack number directly BELOW the board, for example "US$ 0,31" or "US$ 0,67". That number is a current wager/committed stack, NOT the pot. Never return it as pot unless the same number is literally printed after "Pote:".',
'Concrete replay example: if the image shows "Pote: US$ 0,50" above the board and the chip stack underneath says "US$ 0,31", pot must be 0.50. If it later shows "Pote: US$ 0,92" and the chip stack says "US$ 0,67", pot must be 0.92.',
'Tournament formatting matters: "Pote: 630" => numeric 630; pt-BR thousands "Pote: 2.508" => numeric 2508. Never reinterpret those chip counts as decimals.',
'Cash formatting matters: "US$ 0,12" => numeric 0.12. Re-read the literal Pote: digits once before returning JSON.',
'Cross-check the literal Pote: amount against visible committed chips. If the numbers conflict, re-read the Pote: label and lower potConfidence rather than guessing.',
'Seats: use stable clockwise seatIndex values based on physical screen position, beginning at the top-most physical slot as 0. Preserve gaps for empty physical slots; never renumber because a seat is empty.',
'For each occupied seat read nickname, stack, current-street committed chips, dealer marker, fold/inactive state, hero flag and any explicit visible action text near that seat.',
'Tournament stacks/commitments are chip counts. pt-BR thousands separators are not decimals: visible 1.470 => 1470 chips; 2.502 => 2502 chips.',
'Explicit action words such as Pago/Call, Desisto/Fold, Check/Passo, Aposta/Bet, Aumento/Raise and All-in must be captured when visibly attached to a seat. Map Portuguese/English action text to fold/check/call/bet/raise/allin. If no explicit action text is visible, visibleAction=null.',
'heroToAct=true only when hero controls/timer clearly show it is hero turn; false only when clearly not; otherwise null.',
'Do not infer hidden cards, ranges or earlier action history.'
].join('\n');}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store'); if(req.method!=='POST')return res.status(405).json({error:'method'});
 const key=process.env.OPENAI_API_KEY||process.env.CHATGPT; if(!key)return res.status(501).json({error:'OpenAI API key not configured (OPENAI_API_KEY or CHATGPT)'});
 const accessToken=process.env.VISION_ACCESS_TOKEN; const production=process.env.VERCEL_ENV==='production'; if(production&&accessToken){const providedToken=req.headers?.['x-coach-token']??req.headers?.['X-Coach-Token']; if(!tokenMatches(accessToken,providedToken))return res.status(401).json({error:'coach auth required'});}
 const {mode,image,handId,fingerprint=null}=req.body||{}; if(mode!=='replay')return res.status(400).json({error:'replay mode required'}); if(!Number.isInteger(handId)||handId<1)return res.status(400).json({error:'invalid handId'}); if(typeof image!=='string'||!image.startsWith('data:image/'))return res.status(400).json({error:'image required'}); if(image.length>2_500_000)return res.status(413).json({error:'image too large'}); if(fingerprint!==null&&(typeof fingerprint!=='string'||fingerprint.length>256))return res.status(400).json({error:'invalid fingerprint'});
 const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),12000); const t0=Date.now();
 try{
  const body={model:'gpt-5.6-luna',reasoning:{effort:'none'},store:false,max_output_tokens:1200,input:[{role:'user',content:[{type:'input_text',text:prompt()},{type:'input_image',image_url:image,detail:'high'}]}],text:{format:{type:'json_schema',name:'poker_replay_full_state',strict:true,schema:schema()}}};
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal}); const j=await r.json(); if(!r.ok)return res.status(r.status).json({error:j?.error?.message||'full-state vision failed'});
  let parsed; try{parsed=JSON.parse(extractOutputText(j)||'{}');}catch{return res.status(502).json({error:'invalid full-state json'});}
  const board=Array.isArray(parsed.board)&&[0,3,4,5].includes(parsed.board.length)?parsed.board:[]; const street=board.length===5?'river':board.length===4?'turn':board.length===3?'flop':'preflop';
  const seats=Array.isArray(parsed.seats)?parsed.seats.filter(s=>s&&Number.isInteger(s.seatIndex)&&Number.isFinite(s.confidence)).map(s=>({seatIndex:s.seatIndex,actorName:typeof s.actorName==='string'&&s.actorName.trim()?s.actorName.trim().slice(0,64):null,stack:Number.isFinite(s.stack)?s.stack:null,committed:Number.isFinite(s.committed)?s.committed:null,dealer:Boolean(s.dealer),folded:typeof s.folded==='boolean'?s.folded:null,hero:Boolean(s.hero),visibleAction:ACTIONS.includes(s.visibleAction)?s.visibleAction:null,visibleActionAmount:Number.isFinite(s.visibleActionAmount)?s.visibleActionAmount:null,confidence:Math.max(0,Math.min(1,s.confidence))})):[];
  return res.status(200).json({handId,fingerprint,model:'gpt-5.6-luna',tableSize:Number.isInteger(parsed.tableSize)?parsed.tableSize:null,hero:[],board,pot:Number.isFinite(parsed.pot)&&parsed.pot>0?parsed.pot:null,street,heroToAct:typeof parsed.heroToAct==='boolean'?parsed.heroToAct:null,seats,confidence:Number(parsed.confidence)||0,heroConfidence:0,boardConfidence:Number(parsed.boardConfidence)||0,potConfidence:Number(parsed.potConfidence)||0,seatsConfidence:Number(parsed.seatsConfidence)||0,ms:Date.now()-t0});
 }catch(e){if(e?.name==='AbortError')return res.status(504).json({error:'full-state vision timeout'}); return res.status(502).json({error:'full-state vision request failed'});}finally{clearTimeout(timer);}
}

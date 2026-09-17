import crypto from 'node:crypto';
import { geminiJson } from './_gemini.js';

const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const SUITS = ['clubs','diamonds','hearts','spades'];
const ACTIONS = ['fold','check','call','bet','raise','allin'];

function tokenMatches(expected, provided) {
  if (!expected) return true;
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(expected), b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a,b);
}

const cardSchema = {
  type:'object',
  properties:{rank:{type:'string',enum:RANKS},suit:{type:'string',enum:SUITS},confidence:{type:'number',minimum:0,maximum:1}},
  required:['rank','suit','confidence'],
};
const actionSchema = {
  type:'object',
  properties:{type:{type:'string',enum:ACTIONS},amount:{type:['number','null'],minimum:0}},
  required:['type','amount'],
};
function schema(){return {
  type:'object',
  properties:{
    hero:{type:'array',minItems:0,maxItems:2,items:cardSchema},
    board:{type:'array',minItems:0,maxItems:5,items:cardSchema},
    pot:{type:['number','null'],minimum:0},
    potLabelText:{type:['string','null'],maxLength:48},
    heroToAct:{type:['boolean','null']},
    heroActions:{type:'array',maxItems:5,items:actionSchema},
    aggressorName:{type:['string','null'],maxLength:64},
    aggressorCommitted:{type:['number','null'],minimum:0},
    heroCommitted:{type:['number','null'],minimum:0},
    confidence:{type:'number',minimum:0,maximum:1},
    heroConfidence:{type:'number',minimum:0,maximum:1},
    boardConfidence:{type:'number',minimum:0,maximum:1},
    potConfidence:{type:'number',minimum:0,maximum:1},
    actionsConfidence:{type:'number',minimum:0,maximum:1},
    aggressorConfidence:{type:'number',minimum:0,maximum:1},
  },
  required:['hero','board','pot','potLabelText','heroToAct','heroActions','aggressorName','aggressorCommitted','heroCommitted','confidence','heroConfidence','boardConfidence','potConfidence','actionsConfidence','aggressorConfidence'],
};}

function prompt(){return [
  'Poker REPLAY / post-game study only. Read the CURRENT visible public decision state. Never provide strategy.',
  'You receive three images from the SAME replay frame: A = whole table, B = enlarged center/pot region, C = enlarged Hero/action-controls region.',
  'Use A for identity/context, B as PRIMARY source for the central pot label, and C as PRIMARY source for Hero cards and current action buttons.',
  'Hero cards: read exactly two face-up Hero cards only. Read LEFT card first, then RIGHT card. If either card rank or suit is not fully legible, return hero=[] and heroConfidence below 0.70. Never guess from previous frames.',
  'Suit disambiguation must use symbol shape, not color alone: heart has top notch and rounded lobes; diamond is four-point rhombus; spade has pointed top plus stem; club has three lobes plus stem.',
  'Rank disambiguation: distinguish 6 vs 9 by glyph orientation; never infer rank from hand strength. Any uncertainty => hero=[].',
  'Board: community cards left-to-right; valid lengths are only 0,3,4,5. Any partial/turning/unreadable board card => board=[] for this read.',
  'Pot: copy the CENTRAL label that literally says Pote/Pot from image B. A chip-stack number beneath the board is NOT the pot.',
  'potLabelText: copy the short visible central pot label exactly enough to audit the number.',
  'heroToAct=true only if Hero currently has active decision controls/timer. If buttons are gone and an action label is shown, false. Otherwise null.',
  'heroActions: read only CURRENT Hero decision buttons from image C. Map Desisto/Fold, Passo/Check, Pago/Call, Aposta/Bet, Aumento/Raise, All-in. Ignore bet-sizing shortcut chips such as Min/3BB/Pot/Max. Max alone is NOT all-in.',
  'Do not return impossible button sets: CHECK+CALL cannot coexist; BET+RAISE cannot coexist. If button text is ambiguous, omit that action.',
  'aggressorName must be an actual visible player nickname from image A, never an action word.',
  'aggressorCommitted is that opponent current total commitment on the street. heroCommitted is Hero current street commitment.',
  'Portuguese formatting: comma is decimal in cash games; dots can be thousands separators in tournament chips, e.g. 2.508 means 2508.',
  'Precision over coverage. Prefer null/empty arrays/lower confidence instead of guessing.'
].join('\n');}

function weakDecision(parsed){
  const hero=Array.isArray(parsed?.hero)?parsed.hero:[];
  const board=Array.isArray(parsed?.board)?parsed.board:[];
  const actions=Array.isArray(parsed?.heroActions)?parsed.heroActions:[];
  return hero.length===1 || ![0,3,4,5].includes(board.length) || Number(parsed?.confidence||0)<0.74 || (parsed?.heroToAct===true && actions.length<2);
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return res.status(405).json({error:'method'});

  const accessToken=process.env.VISION_ACCESS_TOKEN;
  if(process.env.VERCEL_ENV==='production' && accessToken){
    const provided=req.headers?.['x-coach-token'] ?? req.headers?.['X-Coach-Token'];
    if(!tokenMatches(accessToken,provided)) return res.status(401).json({error:'coach auth required'});
  }

  const {mode,image,potImage,actionImage,handId,fingerprint=null}=req.body||{};
  if(mode!=='replay') return res.status(400).json({error:'replay mode required'});
  if(!Number.isInteger(handId)||handId<1) return res.status(400).json({error:'invalid handId'});
  for(const [name,value] of [['image',image],['potImage',potImage],['actionImage',actionImage]]){
    if(typeof value!=='string'||!value.startsWith('data:image/')) return res.status(400).json({error:`${name} required`});
    if(value.length>2_500_000) return res.status(413).json({error:`${name} too large`});
  }

  const t0=Date.now();
  try{
    const result=await geminiJson({prompt:prompt(),images:[image,potImage,actionImage],schema:schema(),timeoutMs:8500,shouldFallback:weakDecision});
    const parsed=result.parsed||{};
    const board=Array.isArray(parsed.board)&&[0,3,4,5].includes(parsed.board.length)?parsed.board:[];
    const hero=Array.isArray(parsed.hero)&&parsed.hero.length===2?parsed.hero:[];
    const heroActions=Array.isArray(parsed.heroActions)?parsed.heroActions
      .filter(a=>a&&ACTIONS.includes(a.type))
      .map(a=>({type:a.type,amount:Number.isFinite(a.amount)?a.amount:null})):[];

    const out={
      handId,
      fingerprint,
      model:result.model,
      fallback:Boolean(result.fallback),
      hero,
      board,
      pot:Number.isFinite(parsed.pot)&&parsed.pot>0?parsed.pot:null,
      potLabelText:typeof parsed.potLabelText==='string'?parsed.potLabelText.slice(0,48):null,
      heroToAct:typeof parsed.heroToAct==='boolean'?parsed.heroToAct:null,
      heroActions,
      aggressorName:typeof parsed.aggressorName==='string'&&parsed.aggressorName.trim()?parsed.aggressorName.trim().slice(0,64):null,
      aggressorCommitted:Number.isFinite(parsed.aggressorCommitted)?parsed.aggressorCommitted:null,
      heroCommitted:Number.isFinite(parsed.heroCommitted)?parsed.heroCommitted:null,
      confidence:Number(parsed.confidence)||0,
      heroConfidence:hero.length===2?Number(parsed.heroConfidence)||0:0,
      boardConfidence:Number(parsed.boardConfidence)||0,
      potConfidence:Number(parsed.potConfidence)||0,
      actionsConfidence:Number(parsed.actionsConfidence)||0,
      aggressorConfidence:Number(parsed.aggressorConfidence)||0,
      ms:Date.now()-t0,
    };
    console.info('[decision-v2-gemini]',JSON.stringify({handId:out.handId,model:out.model,fallback:out.fallback,pot:out.pot,heroToAct:out.heroToAct,actions:out.heroActions,confidence:out.confidence,ms:out.ms}));
    return res.status(200).json(out);
  }catch(e){
    const status=Number(e?.status)||502;
    if(e?.name==='AbortError') return res.status(504).json({error:'decision vision v2 timeout'});
    return res.status(status).json({error:e?.message||'Gemini decision vision failed'});
  }
}

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

const cardSchema={type:'object',properties:{rank:{type:'string',enum:RANKS},suit:{type:'string',enum:SUITS},confidence:{type:'number',minimum:0,maximum:1}},required:['rank','suit','confidence']};
const actionSchema={type:'object',properties:{type:{type:'string',enum:ACTIONS},amount:{type:['number','null'],minimum:0}},required:['type','amount']};
function schema(){return {type:'object',properties:{hero:{type:'array',minItems:0,maxItems:2,items:cardSchema},board:{type:'array',minItems:0,maxItems:5,items:cardSchema},pot:{type:['number','null'],minimum:0},heroToAct:{type:['boolean','null']},heroActions:{type:'array',maxItems:5,items:actionSchema},aggressorName:{type:['string','null'],maxLength:64},aggressorCommitted:{type:['number','null'],minimum:0},heroCommitted:{type:['number','null'],minimum:0},confidence:{type:'number',minimum:0,maximum:1},heroConfidence:{type:'number',minimum:0,maximum:1},boardConfidence:{type:'number',minimum:0,maximum:1},potConfidence:{type:'number',minimum:0,maximum:1},actionsConfidence:{type:'number',minimum:0,maximum:1},aggressorConfidence:{type:'number',minimum:0,maximum:1}},required:['hero','board','pot','heroToAct','heroActions','aggressorName','aggressorCommitted','heroCommitted','confidence','heroConfidence','boardConfidence','potConfidence','actionsConfidence','aggressorConfidence']};}

function prompt(){return [
  'Poker REPLAY / post-game study screenshot. Read ONLY the current decision-critical public state. Never provide strategy.',
  'Inspect the whole image, but answer compactly and do not spend time cataloguing every seat.',
  'Hero hole cards are MANUAL-ONLY in this runtime. Do NOT inspect, infer or return Hero cards. Always return hero=[] and heroConfidence=0.',
  'Board: return community cards left-to-right; valid lengths are 0, 3, 4 or 5. If any board card is partial/animating/unreadable, return board=[] for this read instead of guessing.',
  'Pot: read ONLY the CENTRAL visible text label beginning with Pote:/Pot:. A separate chip-stack amount directly under the board is a live wager/commitment, NOT the pot.',
  'Examples: Pote: US$ 0,50 with chip stack US$ 0,31 => pot=0.50. Pote: US$ 0,92 with chip stack US$ 0,67 => pot=0.92. Pote: 630 => 630. Pote: 2.508 => 2508.',
  'heroToAct=true only if bottom Hero controls clearly show an active decision.',
  'heroActions: read CURRENT Hero decision buttons only. Cash examples: Pago US$ 0,04 => call 0.04; Aumento para US$ 0,10 => raise 0.10. Tournament examples: Pago 120 => call 120; Aumento para 240 => raise 240; Passo => check; Desisto => fold.',
  'Ignore sizing shortcut chips such as Min/3BB/Pot/Max. Max alone is NOT all-in.',
  'Never return impossible button combinations such as CHECK+CALL or BET+RAISE.',
  'aggressorName: exact visible player nickname responsible for the largest live wager Hero faces. Never return an action word.',
  'Preflop forced blinds are NOT aggression. If only SB/BB are posted and nobody raised above BB, aggressorName=null and aggressorCommitted=null.',
  'Use null / lower confidence instead of guessing.'
].join('\n');}

function weak(parsed){
  const board=Array.isArray(parsed?.board)?parsed.board:[];
  const actions=Array.isArray(parsed?.heroActions)?parsed.heroActions:[];
  return ![0,3,4,5].includes(board.length) || Number(parsed?.confidence||0)<0.74 || (parsed?.heroToAct===true && actions.length<2);
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return res.status(405).json({error:'method'});
  const accessToken=process.env.VISION_ACCESS_TOKEN;
  if(process.env.VERCEL_ENV==='production'&&accessToken){const provided=req.headers?.['x-coach-token']??req.headers?.['X-Coach-Token'];if(!tokenMatches(accessToken,provided))return res.status(401).json({error:'coach auth required'});}
  const {mode,image,handId,fingerprint=null}=req.body||{};
  if(mode!=='replay') return res.status(400).json({error:'replay mode required'});
  if(!Number.isInteger(handId)||handId<1) return res.status(400).json({error:'invalid handId'});
  if(typeof image!=='string'||!image.startsWith('data:image/')) return res.status(400).json({error:'image required'});
  if(image.length>2_000_000) return res.status(413).json({error:'image too large'});
  const t0=Date.now();
  try{
    const result=await geminiJson({prompt:prompt(),images:[image],schema:schema(),timeoutMs:7600,shouldFallback:weak});
    const parsed=result.parsed||{};
    const board=Array.isArray(parsed.board)&&[0,3,4,5].includes(parsed.board.length)?parsed.board:[];
    const heroActions=Array.isArray(parsed.heroActions)?parsed.heroActions.filter(a=>a&&ACTIONS.includes(a.type)).map(a=>({type:a.type,amount:Number.isFinite(a.amount)?a.amount:null})):[];
    return res.status(200).json({handId,fingerprint,model:result.model,fallback:Boolean(result.fallback),hero:[],board,pot:Number.isFinite(parsed.pot)&&parsed.pot>0?parsed.pot:null,heroToAct:typeof parsed.heroToAct==='boolean'?parsed.heroToAct:null,heroActions,aggressorName:typeof parsed.aggressorName==='string'&&parsed.aggressorName.trim()?parsed.aggressorName.trim().slice(0,64):null,aggressorCommitted:Number.isFinite(parsed.aggressorCommitted)?parsed.aggressorCommitted:null,heroCommitted:Number.isFinite(parsed.heroCommitted)?parsed.heroCommitted:null,confidence:Number(parsed.confidence)||0,heroConfidence:0,boardConfidence:Number(parsed.boardConfidence)||0,potConfidence:Number(parsed.potConfidence)||0,actionsConfidence:Number(parsed.actionsConfidence)||0,aggressorConfidence:Number(parsed.aggressorConfidence)||0,ms:Date.now()-t0});
  }catch(e){const status=Number(e?.status)||502;if(e?.name==='AbortError')return res.status(504).json({error:'decision vision timeout'});return res.status(status).json({error:e?.message||'Gemini decision vision failed'});}
}

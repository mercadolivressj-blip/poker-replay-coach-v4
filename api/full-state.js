import crypto from 'node:crypto';
import { geminiJson } from './_gemini.js';

const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const SUITS = ['clubs','diamonds','hearts','spades'];
const STREETS = ['preflop','flop','turn','river'];
const ACTIONS = ['fold','check','call','bet','raise','allin'];

function tokenMatches(expected, provided) {
  if (!expected) return true;
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(expected), b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a,b);
}

const cardSchema = {
  type:'object',
  properties:{
    rank:{type:'string',enum:RANKS},
    suit:{type:'string',enum:SUITS},
    confidence:{type:'number',minimum:0,maximum:1},
  },
  required:['rank','suit','confidence'],
};

function schema(){
  return {
    type:'object',
    properties:{
      tableSize:{type:['integer','null'],enum:[2,3,4,5,6,7,8,9,10,null]},
      hero:{type:'array',minItems:0,maxItems:2,items:cardSchema},
      board:{type:'array',minItems:0,maxItems:5,items:cardSchema},
      pot:{type:['number','null'],minimum:0},
      street:{type:'string',enum:STREETS},
      heroToAct:{type:['boolean','null']},
      seats:{type:'array',maxItems:10,items:{
        type:'object',
        properties:{
          seatIndex:{type:'integer',minimum:0,maximum:9},
          actorName:{type:['string','null'],maxLength:64},
          stack:{type:['number','null'],minimum:0},
          committed:{type:['number','null'],minimum:0},
          dealer:{type:'boolean'},
          folded:{type:['boolean','null']},
          hero:{type:'boolean'},
          visibleAction:{type:['string','null'],enum:[...ACTIONS,null]},
          visibleActionAmount:{type:['number','null'],minimum:0},
          confidence:{type:'number',minimum:0,maximum:1},
        },
        required:['seatIndex','actorName','stack','committed','dealer','folded','hero','visibleAction','visibleActionAmount','confidence'],
      }},
      confidence:{type:'number',minimum:0,maximum:1},
      heroConfidence:{type:'number',minimum:0,maximum:1},
      boardConfidence:{type:'number',minimum:0,maximum:1},
      potConfidence:{type:'number',minimum:0,maximum:1},
      seatsConfidence:{type:'number',minimum:0,maximum:1},
    },
    required:['tableSize','hero','board','pot','street','heroToAct','seats','confidence','heroConfidence','boardConfidence','potConfidence','seatsConfidence'],
  };
}

function prompt(){return [
  'Poker REPLAY / post-game study screenshot. Read visible public table state only. Never provide strategy.',
  'Inspect the whole table image directly. Precision over coverage: use null/low confidence instead of guessing.',
  'Hero hole cards: if both are face-up and legible, read exactly two. If either rank OR suit is not clear, return hero=[] and heroConfidence below 0.70. Never infer from previous frames.',
  'Card ranks must be one of 2-9,T,J,Q,K,A. Suits must be identified by SHAPE, not color alone: hearts has a top notch and rounded lobes; diamonds is a four-point rhombus; spades has pointed top with stem; clubs has three lobes with stem.',
  'Never silently change only a suit because a symbol is blurry. Uncertain card => omit the whole Hero pair for this read.',
  'Before returning JSON, perform a complete clockwise perimeter sweep of the table starting at the top-most physical seat and continuing through every visible seat slot.',
  'Do not skip a seat because its avatar overlaps, text is dim, the player folded, is away/disconnected, or the nickname is small. Do not merge adjacent seats into one.',
  'tableSize means physical table capacity / seat layout, not number of active players.',
  'Board: return community cards left-to-right; valid lengths are only 0, 3, 4 or 5. If one board card is partial/animating/unreadable, return board=[] for this read instead of guessing.',
  'Pot: read ONLY the central visible text label beginning with Pote:/Pot:. A separate chip-stack number below the board is a wager/commitment, not the pot.',
  'Cash formatting: US$ 0,12 means 0.12. Tournament formatting: Pote: 2.508 means 2508 chips, not 2.508.',
  'Seats: use stable clockwise seatIndex values based on physical screen position, beginning at the top-most physical slot as 0. Preserve gaps for empty physical slots.',
  'For each occupied seat read nickname, stack, current-street committed chips, dealer marker, fold/inactive state, hero flag and any explicit visible action text.',
  'Explicit action words such as Pago/Call, Desisto/Fold, Check/Passo, Aposta/Bet, Aumento/Raise and All-in must be captured when visibly attached to a seat.',
  'heroToAct=true only when Hero controls/timer clearly show it is Hero turn; false only when clearly not; otherwise null.',
  'Do not infer hidden cards, ranges or earlier action history.'
].join('\n');}

function fullReadLooksWeak(parsed){
  const hero = Array.isArray(parsed?.hero) ? parsed.hero : [];
  const board = Array.isArray(parsed?.board) ? parsed.board : [];
  const heroPresenceButUnclear = hero.length === 1;
  const invalidBoardCount = ![0,3,4,5].includes(board.length);
  return heroPresenceButUnclear || invalidBoardCount || Number(parsed?.confidence || 0) < 0.72;
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return res.status(405).json({error:'method'});

  const accessToken=process.env.VISION_ACCESS_TOKEN;
  if(process.env.VERCEL_ENV==='production' && accessToken){
    const provided=req.headers?.['x-coach-token'] ?? req.headers?.['X-Coach-Token'];
    if(!tokenMatches(accessToken,provided)) return res.status(401).json({error:'coach auth required'});
  }

  const {mode,image,handId,fingerprint=null}=req.body||{};
  if(mode!=='replay') return res.status(400).json({error:'replay mode required'});
  if(!Number.isInteger(handId)||handId<1) return res.status(400).json({error:'invalid handId'});
  if(typeof image!=='string'||!image.startsWith('data:image/')) return res.status(400).json({error:'image required'});
  if(image.length>2_500_000) return res.status(413).json({error:'image too large'});
  if(fingerprint!==null&&(typeof fingerprint!=='string'||fingerprint.length>256)) return res.status(400).json({error:'invalid fingerprint'});

  const t0=Date.now();
  try{
    const result=await geminiJson({prompt:prompt(),images:[image],schema:schema(),timeoutMs:10000,shouldFallback:fullReadLooksWeak});
    const parsed=result.parsed||{};
    const board=Array.isArray(parsed.board)&&[0,3,4,5].includes(parsed.board.length)?parsed.board:[];
    const hero=Array.isArray(parsed.hero)&&parsed.hero.length===2?parsed.hero:[];
    const street=board.length===5?'river':board.length===4?'turn':board.length===3?'flop':'preflop';
    const seats=Array.isArray(parsed.seats)?parsed.seats
      .filter(s=>s&&Number.isInteger(s.seatIndex)&&Number.isFinite(s.confidence))
      .map(s=>({
        seatIndex:s.seatIndex,
        actorName:typeof s.actorName==='string'&&s.actorName.trim()?s.actorName.trim().slice(0,64):null,
        stack:Number.isFinite(s.stack)?s.stack:null,
        committed:Number.isFinite(s.committed)?s.committed:null,
        dealer:Boolean(s.dealer),
        folded:typeof s.folded==='boolean'?s.folded:null,
        hero:Boolean(s.hero),
        visibleAction:ACTIONS.includes(s.visibleAction)?s.visibleAction:null,
        visibleActionAmount:Number.isFinite(s.visibleActionAmount)?s.visibleActionAmount:null,
        confidence:Math.max(0,Math.min(1,s.confidence)),
      })):[];

    return res.status(200).json({
      handId,
      fingerprint,
      model:result.model,
      fallback:Boolean(result.fallback),
      tableSize:Number.isInteger(parsed.tableSize)?parsed.tableSize:null,
      hero,
      board,
      pot:Number.isFinite(parsed.pot)&&parsed.pot>0?parsed.pot:null,
      street,
      heroToAct:typeof parsed.heroToAct==='boolean'?parsed.heroToAct:null,
      seats,
      confidence:Number(parsed.confidence)||0,
      heroConfidence:hero.length===2?Number(parsed.heroConfidence)||0:0,
      boardConfidence:Number(parsed.boardConfidence)||0,
      potConfidence:Number(parsed.potConfidence)||0,
      seatsConfidence:Number(parsed.seatsConfidence)||0,
      ms:Date.now()-t0,
    });
  }catch(e){
    const status=Number(e?.status)||502;
    if(e?.name==='AbortError') return res.status(504).json({error:'full-state vision timeout'});
    return res.status(status).json({error:e?.message||'Gemini full-state vision failed'});
  }
}

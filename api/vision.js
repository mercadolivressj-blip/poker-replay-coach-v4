import crypto from 'node:crypto';
import {
  SYSTEM_HERO, SYSTEM_BOARD, SYSTEM_ACTIONS, SYSTEM_QUICK, SYSTEM_SEAT_TILES,
  FROZEN_MODELS, FROZEN_VISION_REF,
  normalizeLovableVision, heroReadConclusive, boardReadConclusive, toLegacyCards,
} from '../src/vision/lovable-frozen.js';

const KINDS = new Set(['hero','board','actions','quick','seat_tiles']);
const PROMPTS = { hero:SYSTEM_HERO, board:SYSTEM_BOARD, actions:SYSTEM_ACTIONS, quick:SYSTEM_QUICK, seat_tiles:SYSTEM_SEAT_TILES };
const MAX_TOKENS = { hero:160, board:160, actions:300, quick:600, seat_tiles:300 };

function tokenMatches(expected, provided) {
  if (!expected) return true;
  if (typeof provided !== 'string') return false;
  const a=Buffer.from(expected), b=Buffer.from(provided);
  return a.length===b.length && crypto.timingSafeEqual(a,b);
}
function splitDataUrl(image) {
  const m=String(image??'').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
  return m ? { mimeType:m[1], data:m[2] } : null;
}
function textOfGemini(j) {
  return (j?.candidates?.[0]?.content?.parts ?? []).map((p)=>typeof p?.text==='string'?p.text:'').join('').trim();
}
async function geminiCall({ apiKey, model, prompt, image, maxTokens, signal }) {
  const inline=splitDataUrl(image);
  if(!inline) throw new Error('bad-image');
  const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{
    method:'POST', signal,
    headers:{'content-type':'application/json','x-goog-api-key':apiKey},
    body:JSON.stringify({
      systemInstruction:{parts:[{text:prompt}]},
      contents:[{role:'user',parts:[{text:'JSON agora.'},{inlineData:{mimeType:inline.mimeType,data:inline.data}}]}],
      generationConfig:{responseMimeType:'application/json',temperature:0,maxOutputTokens:maxTokens},
    }),
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok){ const e=new Error(j?.error?.message||`Gemini HTTP ${r.status}`); e.status=r.status; throw e; }
  const text=textOfGemini(j);
  if(!text) throw new Error('empty-gemini');
  return text;
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return res.status(405).json({error:'method'});

  const configuredKey=process.env.GEMINI_API_KEY || '';
  const providedKey=typeof req.headers?.['x-gemini-key']==='string' ? req.headers['x-gemini-key'].trim() : '';
  const apiKey=configuredKey || providedKey;
  if(!apiKey) return res.status(501).json({error:'GEMINI_API_KEY not configured'});

  const accessToken=process.env.VISION_ACCESS_TOKEN;
  const providedToken=req.headers?.['x-coach-token'];
  if(accessToken && !tokenMatches(accessToken,providedToken)) return res.status(401).json({error:'vision auth required'});

  const {kind,image,handId,expectedCount=null,fingerprint=null,mode='fast'}=req.body||{};
  if(!KINDS.has(kind)||!Number.isInteger(handId)) return res.status(400).json({error:'invalid input'});
  if(typeof image!=='string'||!image.startsWith('data:image/')) return res.status(400).json({error:'image must be a data URL'});
  if(image.length>3_000_000) return res.status(413).json({error:'image too large'});
  if(fingerprint!==null&&(typeof fingerprint!=='string'||fingerprint.length>256)) return res.status(400).json({error:'invalid fingerprint'});

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),9000);
  const t0=Date.now();
  try{
    const models=(kind==='hero'||kind==='board')&&mode!=='precise'
      ? [FROZEN_MODELS.fast,FROZEN_MODELS.fallback]
      : [kind==='hero'||kind==='board'?FROZEN_MODELS.fallback:FROZEN_MODELS.fast];
    let normalized=null, usedModel=null, attempts=0;
    for(const model of models){
      attempts++;
      const raw=await geminiCall({apiKey,model,prompt:PROMPTS[kind],image,maxTokens:MAX_TOKENS[kind],signal:controller.signal});
      normalized=normalizeLovableVision(kind,raw); usedModel=model;
      const done=kind==='hero'?heroReadConclusive(normalized):kind==='board'?boardReadConclusive(normalized):true;
      if(done) break;
    }
    if(!normalized) return res.status(502).json({error:'empty normalized vision'});
    const legacyCards=(kind==='hero'||kind==='board')?toLegacyCards(kind,normalized):[];
    return res.status(200).json({
      ...normalized,
      cards:legacyCards,
      handId, expectedCount, fingerprint,
      readerModel:usedModel, attempts,
      visionRef:FROZEN_VISION_REF,
      ms:Date.now()-t0,
    });
  }catch(e){
    if(e?.name==='AbortError') return res.status(504).json({error:'vision timeout'});
    const status=Number(e?.status)||502;
    return res.status(status>=400&&status<600?status:502).json({error:e?.message||'vision request failed'});
  }finally{ clearTimeout(timer); }
}

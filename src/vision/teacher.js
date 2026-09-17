function freezeKey(kind, handId, expectedCount, fingerprint = '') { return `${kind}:${handId}:${expectedCount ?? '-'}:${fingerprint || '-'}`; }
function rankSig(cards = []) { return cards.map((c) => c?.rank || '?').join(''); }
function cardSig(cards = []) { return cards.map((c) => `${c?.rank || '?'}:${c?.suit || '?'}`).join('|'); }

export class VisionTeacher {
  constructor() {
    this.busy = false; this.last = null; this.enabled = true; this.done = new Set(); this.attempts = new Map(); this.lastError = null; this.generation = 0; this.controller = null; this.conflicts = new Map();
    try {
      this.accessToken = sessionStorage.getItem('prc.vision-token') || '';
      this.geminiKey = sessionStorage.getItem('prc.gemini-key') || this.accessToken || '';
    } catch { this.accessToken=''; this.geminiKey=''; }
  }
  setAccessToken(token) {
    const value=String(token||'').trim(); this.accessToken=value; this.geminiKey=value;
    try {
      if(value){ sessionStorage.setItem('prc.vision-token',value); sessionStorage.setItem('prc.gemini-key',value); }
      else { sessionStorage.removeItem('prc.vision-token'); sessionStorage.removeItem('prc.gemini-key'); }
    } catch{}
    this.resetSession();
  }
  setGeminiKey(key) { this.setAccessToken(key); }
  resetSession() { this.generation++; this.controller?.abort(); this.controller=null; this.busy=false; this.last=null; this.done.clear(); this.attempts.clear(); this.conflicts.clear(); this.lastError=null; this.enabled=true; }
  resetHand(handId) { this.generation++; this.controller?.abort(); this.controller=null; this.busy=false; this.last=null; this.lastError=null; this.conflicts.clear(); for(const k of this.done) if(!k.includes(`:${handId}:`))this.done.delete(k); for(const k of this.attempts.keys())if(!k.includes(`:${handId}:`))this.attempts.delete(k); }
  shouldRead(kind,handId,expectedCount,fingerprint=''){ const key=freezeKey(kind,handId,expectedCount,fingerprint); return this.enabled&&!this.done.has(key)&&(this.attempts.get(key)||0)<2; }
  async read(kind,canvas,handId,{expectedCount=null,fingerprint='',mode='fast'}={}){
    const key=freezeKey(kind,handId,expectedCount,fingerprint); if(this.busy||!this.shouldRead(kind,handId,expectedCount,fingerprint))return null;
    const generation=this.generation; this.busy=true; this.attempts.set(key,(this.attempts.get(key)||0)+1); const controller=new AbortController(); this.controller=controller;
    try{
      const image=canvas.toDataURL('image/jpeg',0.86), timer=setTimeout(()=>controller.abort(),10000); let r;
      try{ r=await fetch('/api/vision',{method:'POST',headers:{'content-type':'application/json',...(this.accessToken?{'x-coach-token':this.accessToken}:{}),...(this.geminiKey?{'x-gemini-key':this.geminiKey}:{})},body:JSON.stringify({kind,image,handId,expectedCount,fingerprint,mode}),signal:controller.signal}); } finally{ clearTimeout(timer); }
      if(generation!==this.generation)return null;
      if(!r.ok){ this.lastError=`HTTP ${r.status}`; if(r.status===401||r.status===404||r.status===501)this.enabled=false; return null; }
      const out=await r.json(); if(generation!==this.generation)return null; this.last=out; this.lastError=null;
      const minCard=Math.min(1,...(out.cards||[]).map((c)=>Number(c.confidence)||0));
      const strong=Number(out.confidence)>=0.9&&minCard>=0.9;
      if(!strong) return null;

      // If the fast local reader already has a complete rank pair and Gemini disagrees,
      // one Gemini sample is not enough to overwrite it. Require the exact same full
      // rank+suit read twice. This preserves the anti-flicker behavior while still
      // allowing Gemini to correct a genuinely wrong local classifier.
      const localComplete = typeof fingerprint==='string' && expectedCount && fingerprint.length===expectedCount && !fingerprint.includes('?');
      const conflict = localComplete && rankSig(out.cards)!==fingerprint;
      if(conflict){
        const sig=cardSig(out.cards); const prev=this.conflicts.get(key);
        const n=prev?.sig===sig ? prev.n+1 : 1;
        this.conflicts.set(key,{sig,n});
        if(n<2) return null;
      } else this.conflicts.delete(key);

      this.done.add(key); return out;
    }catch(e){ if(generation!==this.generation)return null; this.lastError=e?.name==='AbortError'?'timeout':'request-error'; return null; }
    finally{ if(generation===this.generation){ this.busy=false; if(this.controller===controller)this.controller=null; } }
  }
}

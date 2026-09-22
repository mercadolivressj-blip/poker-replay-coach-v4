import { parsePokerStarsActionText } from '../brain/action-text.js';

const SRC='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
let loader=null,workerPromise=null;
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

async function ensure(){
  if(typeof window==='undefined')return false;
  if(window.Tesseract)return true;
  if(loader)return loader;
  loader=new Promise((resolve)=>{
    const s=document.createElement('script');let done=false;
    const finish=(ok)=>{if(done)return;done=true;clearTimeout(timer);resolve(Boolean(ok&&window.Tesseract));};
    const timer=setTimeout(()=>finish(false),7000);
    s.src=SRC;s.async=true;s.addEventListener('load',()=>finish(true),{once:true});s.addEventListener('error',()=>finish(false),{once:true});document.head.appendChild(s);
  });
  return loader;
}

async function getWorker(){
  if(workerPromise)return workerPromise;
  workerPromise=(async()=>{
    if(!await ensure())return null;
    try{
      const w=await window.Tesseract.createWorker('eng');
      await w.setParameters({
        tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,$ -',
        // PokerStars action plate is normally a single compact line. PSM 7 is
        // materially faster and more stable than sparse-text mode for this ROI.
        tessedit_pageseg_mode:'7',
        preserve_interword_spaces:'1',
      });
      return w;
    }catch{return null;}
  })();
  return workerPromise;
}

function upscale(source,scale=3.2){
  const c=document.createElement('canvas');c.width=Math.max(120,Math.round(source.width*scale));c.height=Math.max(48,Math.round(source.height*scale));
  const ctx=c.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(source,0,0,c.width,c.height);return c;
}

function contrast(source,{invert=false,threshold=145,scale=2.7}={}){
  const c=upscale(source,scale),ctx=c.getContext('2d',{willReadFrequently:true}),im=ctx.getImageData(0,0,c.width,c.height);
  for(let i=0;i<im.data.length;i+=4){
    const L=.299*im.data[i]+.587*im.data[i+1]+.114*im.data[i+2];
    const light=L>threshold;
    const v=invert?(light?0:255):(light?255:0);
    im.data[i]=v;im.data[i+1]=v;im.data[i+2]=v;im.data[i+3]=255;
  }
  ctx.putImageData(im,0,0);return c;
}

function quickSignature(source){
  try{
    const c=document.createElement('canvas');c.width=12;c.height=5;
    const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0,12,5);
    const d=ctx.getImageData(0,0,12,5).data;let s='';
    for(let i=0;i<d.length;i+=16){const y=Math.round((d[i]+d[i+1]+d[i+2])/3/16);s+=y.toString(16);}
    return s;
  }catch{return '';}
}

async function recognize(worker,image){
  const t0=performance.now();
  const out=await worker.recognize(image);
  const rawText=(out?.data?.text||'').trim(),text=rawText.replace(/\s+/g,' ').trim();
  const confidence=Number(out?.data?.confidence)||0;
  return {text,rawText,confidence,parsed:parsePokerStarsActionText(text),ms:performance.now()-t0};
}

export class ActionTextOcr{
  constructor(){this.busy=false;this.cache=new Map();}
  prewarm(){return getWorker();}

  async readFast(source,{cacheMs=550}={}){
    const worker=await getWorker();if(!worker)return {text:'',confidence:0,parsed:null,unavailable:true};
    const sig=quickSignature(source),now=performance.now(),cached=sig?this.cache.get(sig):null;
    if(cached&&now-cached.at<cacheMs)return {...cached.value,cached:true,ms:0};
    // Never queue a large OCR backlog. A later fresh frame is more useful than
    // recognizing an old action plate after the turn already moved on.
    if(this.busy)return {text:'',confidence:0,parsed:null,busy:true};
    this.busy=true;
    try{
      // One high-contrast pass only. If it misses, the next action-band frame can
      // retry; this keeps the hot path in the low hundreds of milliseconds rather
      // than running four serial OCR variants.
      const image=contrast(source,{invert:true,threshold:146,scale:2.45});
      const value=await recognize(worker,image);
      if(sig)this.cache.set(sig,{at:performance.now(),value});
      if(this.cache.size>48){const first=this.cache.keys().next().value;this.cache.delete(first);}
      return value;
    }catch{return {text:'',confidence:0,parsed:null,error:true};}
    finally{this.busy=false;}
  }

  async readBatch(source){
    const worker=await getWorker();if(!worker)return {text:'',confidence:0,parsed:null,unavailable:true};
    if(this.busy)return {text:'',confidence:0,parsed:null,busy:true};
    this.busy=true;
    try{
      await worker.setParameters({tessedit_pageseg_mode:'6'});
      const image=contrast(source,{invert:true,threshold:146,scale:1.7});
      return await recognize(worker,image);
    }catch{return {text:'',confidence:0,parsed:null,error:true};}
    finally{try{await worker.setParameters({tessedit_pageseg_mode:'7'});}catch{}this.busy=false;}
  }

  async read(source,{timeoutMs=1400}={}){
    const worker=await getWorker();if(!worker)return {text:'',confidence:0,parsed:null,unavailable:true};
    while(this.busy)await sleep(8);this.busy=true;
    try{
      const variants=[
        contrast(source,{invert:true,threshold:146,scale:2.7}),
        upscale(source,3.0),
        contrast(source,{invert:true,threshold:132,scale:3.0}),
        contrast(source,{invert:false,threshold:155,scale:3.0}),
      ];
      let best={text:'',confidence:0,parsed:null};
      for(const image of variants){
        const out=await Promise.race([recognize(worker,image),sleep(timeoutMs).then(()=>null)]);
        if(!out)continue;
        if(out.parsed)return out;
        if(out.confidence>best.confidence)best=out;
      }
      return best;
    }catch{return {text:'',confidence:0,parsed:null,error:true};}
    finally{this.busy=false;}
  }
}

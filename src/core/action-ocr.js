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
        tessedit_pageseg_mode:'11',
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

function contrast(source,{invert=false,threshold=145}={}){
  const c=upscale(source,3.4),ctx=c.getContext('2d',{willReadFrequently:true}),im=ctx.getImageData(0,0,c.width,c.height);
  for(let i=0;i<im.data.length;i+=4){
    const L=.299*im.data[i]+.587*im.data[i+1]+.114*im.data[i+2];
    const light=L>threshold;
    const v=invert?(light?0:255):(light?255:0);
    im.data[i]=v;im.data[i+1]=v;im.data[i+2]=v;im.data[i+3]=255;
  }
  ctx.putImageData(im,0,0);return c;
}

export class ActionTextOcr{
  constructor(){this.busy=false;}
  prewarm(){return getWorker();}
  async read(source,{timeoutMs=1400}={}){
    const worker=await getWorker();if(!worker)return {text:'',confidence:0,parsed:null,unavailable:true};
    while(this.busy)await sleep(8);this.busy=true;
    try{
      const variants=[
        upscale(source,3.2),
        contrast(source,{invert:true,threshold:132}),
        contrast(source,{invert:true,threshold:160}),
        contrast(source,{invert:false,threshold:145}),
      ];
      let best={text:'',confidence:0,parsed:null};
      for(const image of variants){
        const t0=performance.now();
        const out=await Promise.race([worker.recognize(image),sleep(timeoutMs).then(()=>null)]);
        if(!out)continue;
        const text=(out.data?.text||'').replace(/\s+/g,' ').trim();
        const confidence=Number(out.data?.confidence)||0;
        const parsed=parsePokerStarsActionText(text);
        const candidate={text,confidence,parsed,ms:performance.now()-t0};
        if(parsed)return candidate;
        if(confidence>best.confidence)best=candidate;
      }
      return best;
    }catch{return {text:'',confidence:0,parsed:null,error:true};}
    finally{this.busy=false;}
  }
}

export class FrameBus{
  constructor(getSource,{maxFps=30}={}){this.getSource=getSource;this.maxFps=maxFps;this.handlers=[];this.running=false;this.seq=0;this.last=0;this.canvas=document.createElement('canvas');}
  on(fn){this.handlers.push(fn);return()=>this.handlers=this.handlers.filter(x=>x!==fn)}
  start(){if(this.running)return;this.running=true;const loop=(ts)=>{if(!this.running)return;const min=1000/this.maxFps;if(ts-this.last>=min){this.last=ts;const src=this.getSource();const w=src?.videoWidth||src?.naturalWidth||0,h=src?.videoHeight||src?.naturalHeight||0;if(w&&h){if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h}const ctx=this.canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(src,0,0,w,h);const frame={seq:++this.seq,ts:performance.now(),canvas:this.canvas,w,h};for(const fn of this.handlers)fn(frame);}}requestAnimationFrame(loop)};requestAnimationFrame(loop)}
  stop(){this.running=false}
}

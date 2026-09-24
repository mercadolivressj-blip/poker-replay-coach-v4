const num=(v,d=null)=>Number.isFinite(Number(v))?Number(v):d;

export const MTT_STACK_DEPTHS=Object.freeze([8,10,12,15,20,25,30,40,50,60,75,100]);

export function normalizeDepthMeta(meta={}){
 const anchor=num(meta.stackDepthBB);
 if(!(anchor>0))return null;
 const minRaw=num(meta.minEffectiveBB,anchor),maxRaw=num(meta.maxEffectiveBB,anchor);
 const min=Math.min(minRaw,maxRaw),max=Math.max(minRaw,maxRaw);
 return{anchor,min,max,exact:min===anchor&&max===anchor};
}

export function coversEffectiveBB(meta,effectiveBB){
 const d=normalizeDepthMeta(meta),bb=num(effectiveBB);
 return Boolean(d&&bb!=null&&bb>=d.min-1e-9&&bb<=d.max+1e-9);
}

export function depthDistance(meta,effectiveBB){
 const d=normalizeDepthMeta(meta),bb=num(effectiveBB);
 return d&&bb!=null?Math.abs(bb-d.anchor):Infinity;
}

export function nearestTargetDepth(effectiveBB,depths=MTT_STACK_DEPTHS){
 const bb=num(effectiveBB);
 if(!(bb>0)||!Array.isArray(depths)||!depths.length)return null;
 let best=null;
 for(const raw of depths){
  const depth=num(raw);if(!(depth>0))continue;
  const distance=Math.abs(bb-depth);
  if(!best||distance<best.distanceBB||(distance===best.distanceBB&&depth<best.depthBB))best={depthBB:depth,distanceBB:distance,exact:distance<1e-9};
 }
 return best;
}

export function suggestedNonOverlappingBands(depths=MTT_STACK_DEPTHS){
 const d=[...new Set(depths.map(Number).filter(x=>Number.isFinite(x)&&x>0))].sort((a,b)=>a-b);
 return d.map((anchor,i)=>({
  stackDepthBB:anchor,
  minEffectiveBB:i===0?anchor:(d[i-1]+anchor)/2,
  maxEffectiveBB:i===d.length-1?anchor:(anchor+d[i+1])/2
 }));
}

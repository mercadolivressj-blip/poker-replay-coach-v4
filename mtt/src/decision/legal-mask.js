const MAP=Object.freeze({LIMP:'CALL',COMPLETE:'CALL',JAM:'ALLIN',SHOVE:'ALLIN'});
export function normalizeActionCode(a){const x=String(a||'').trim().toUpperCase();return MAP[x]||x}
export function legalSet(actions=[]){return new Set(actions.map(normalizeActionCode))}
export function maskDistribution(distribution={},legalActions=[]){
 const legal=legalSet(legalActions),out={};
 for(const [k,v] of Object.entries(distribution||{})){
  let a=normalizeActionCode(k);if(a==='ALLIN'&&!legal.has('ALLIN')&&legal.has('RAISE'))a='RAISE';
  const w=Number(v);if(w>0&&legal.has(a))out[a]=(out[a]||0)+w;
 }
 return out;
}

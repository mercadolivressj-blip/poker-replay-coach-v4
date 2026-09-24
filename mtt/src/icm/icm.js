const cleanPayouts=(p,n)=>{const x=p.map(Number).map(v=>Number.isFinite(v)&&v>=0?v:0).slice(0,n);while(x.length<n)x.push(0);return x};

export function icmEquities(stacks,payouts){
 const s=stacks.map(Number),n=s.length;if(!n)return[];
 if(s.some(x=>!Number.isFinite(x)||x<=0))throw new Error('icm_requires_positive_active_stacks');
 const p=cleanPayouts(payouts,n),active0=[...Array(n).keys()],memo=new Map();
 function rec(active){
  const key=active.join(',');if(memo.has(key))return memo.get(key).slice();const out=Array(n).fill(0);if(!active.length){memo.set(key,out);return out.slice()}
  const rank=n-active.length,total=active.reduce((a,i)=>a+s[i],0);
  for(const w of active){const q=s[w]/total;out[w]+=q*(p[rank]||0);const child=rec(active.filter(i=>i!==w));for(let i=0;i<n;i++)out[i]+=q*child[i]}
  memo.set(key,out);return out.slice();
 }
 return rec(active0);
}

export function icmWithBusted(stacks,payouts){
 const s=stacks.map(Number),n=s.length,p=cleanPayouts(payouts,n),positive=[],busted=[];
 s.forEach((v,i)=>(Number.isFinite(v)&&v>0?positive:busted).push(i));
 if(!busted.length)return icmEquities(s,p);
 const out=Array(n).fill(0),bottom=p.slice(positive.length);
 // If several players bust in the same modeled outcome and tie order is unknown,
 // split the remaining bottom payouts equally instead of inventing an ordering.
 const bustedShare=bottom.length?bottom.reduce((a,b)=>a+b,0)/busted.length:0;
 for(const i of busted)out[i]=bustedShare;
 if(positive.length){
  const survivorStacks=positive.map(i=>s[i]),survivorPayouts=p.slice(0,positive.length),ev=icmEquities(survivorStacks,survivorPayouts);
  positive.forEach((idx,j)=>out[idx]=ev[j]);
 }
 return out;
}

export function icmSummary(stacks,payouts){
 const equities=stacks.every(x=>Number(x)>0)?icmEquities(stacks,payouts):icmWithBusted(stacks,payouts),prizePool=payouts.reduce((a,b)=>a+Number(b||0),0),totalChips=stacks.reduce((a,b)=>a+Math.max(0,Number(b||0)),0);
 return equities.map((ev,i)=>({seat:i,stack:Number(stacks[i]||0),chipShare:totalChips?Math.max(0,Number(stacks[i]||0))/totalChips:0,icmEV:ev,icmShare:prizePool?ev/prizePool:0}));
}

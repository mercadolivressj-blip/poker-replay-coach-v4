const cleanStacks=s=>s.map(Number).map(x=>Number.isFinite(x)&&x>0?x:0);
const cleanPayouts=(p,n)=>{const x=p.map(Number).map(v=>Number.isFinite(v)&&v>=0?v:0).slice(0,n);while(x.length<n)x.push(0);return x};

export function icmEquities(stacks,payouts){
 const s=cleanStacks(stacks),n=s.length;if(!n)return[];const p=cleanPayouts(payouts,n),active0=[...Array(n).keys()].filter(i=>s[i]>0),memo=new Map();
 function rec(active){
  const key=active.join(',');if(memo.has(key))return memo.get(key).slice();const out=Array(n).fill(0);if(!active.length){memo.set(key,out);return out.slice()}
  const rank=n-active.length,total=active.reduce((a,i)=>a+s[i],0);if(total<=0){memo.set(key,out);return out.slice()}
  for(const w of active){const q=s[w]/total;out[w]+=q*(p[rank]||0);const child=rec(active.filter(i=>i!==w));for(let i=0;i<n;i++)out[i]+=q*child[i]}
  memo.set(key,out);return out.slice();
 }
 return rec(active0);
}

export function icmSummary(stacks,payouts){
 const equities=icmEquities(stacks,payouts),prizePool=payouts.reduce((a,b)=>a+Number(b||0),0),totalChips=stacks.reduce((a,b)=>a+Number(b||0),0);
 return equities.map((ev,i)=>({seat:i,stack:Number(stacks[i]||0),chipShare:totalChips?Number(stacks[i]||0)/totalChips:0,icmEV:ev,icmShare:prizePool?ev/prizePool:0}));
}

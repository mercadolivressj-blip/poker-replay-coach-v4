export const CERTIFICATION_LEVELS=Object.freeze({
 'reference-only':0,
 'solver-derived':1,
 'solver-verified':2,
 'audited':3
});

export function certificationRank(x){return CERTIFICATION_LEVELS[String(x||'')]??-1}
export function certificationMeets(actual,required='solver-verified'){
 return certificationRank(actual)>=certificationRank(required)&&certificationRank(required)>=0;
}
export function decisionCertificationGate(meta,{minimum='solver-verified',allowUnverified=false}={}){
 const actual=meta?.certification??null;
 if(allowUnverified)return{allowed:true,actual,minimum,bypass:true};
 const allowed=certificationMeets(actual,minimum);
 return{allowed,actual,minimum,bypass:false,reason:allowed?null:`strategy_certification_below_${minimum}`};
}

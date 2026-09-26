import { verifyOracleDomain } from './oracle-domain.js';

export function teacherLaneForNode(node={}){
  if(node.street==='preflop') return 'preflop';
  if(['flop','turn','river'].includes(node.street)&&node.activePlayers===2) return 'postflop-heads-up';
  if(['flop','turn','river'].includes(node.street)&&Number.isInteger(node.activePlayers)&&node.activePlayers>=3) return 'postflop-multiway';
  return 'unsupported';
}

export function createTeacherRegistry(entries=[]){
  const registry=(Array.isArray(entries)?entries:[]).map((entry,index)=>{
    if(!entry||typeof entry!=='object') throw new TypeError(`teacher ${index} must be an object`);
    if(!entry.teacherId) throw new TypeError(`teacher ${index} teacherId is required`);
    if(!entry.family) throw new TypeError(`teacher ${index} family is required`);
    if(typeof entry.provider!=='function') throw new TypeError(`teacher ${index} provider is required`);
    if(!entry.domain||typeof entry.domain!=='object') throw new TypeError(`teacher ${index} domain is required`);
    return {
      teacherId:String(entry.teacherId),
      family:String(entry.family),
      lane:String(entry.lane||'any'),
      domain:entry.domain,
      provider:entry.provider,
      source:String(entry.source||entry.teacherId),
    };
  });
  const duplicateIds=registry.map(x=>x.teacherId).filter((id,i,a)=>a.indexOf(id)!==i);
  if(duplicateIds.length) throw new TypeError(`duplicate teacherId: ${[...new Set(duplicateIds)].join(',')}`);

  async function provider(node={}){
    const lane=teacherLaneForNode(node);
    const oracles=[];
    const routing=[];
    for(const teacher of registry){
      const laneOk=teacher.lane==='any'||teacher.lane===lane;
      const domainCheck=laneOk?verifyOracleDomain(node,teacher.domain):{ok:false,reasons:['teacher_lane_mismatch'],checks:{}};
      if(!domainCheck.ok){
        routing.push({teacherId:teacher.teacherId,family:teacher.family,eligible:false,lane,reason:domainCheck.reasons});
        continue;
      }
      let rows;
      try{
        rows=await teacher.provider(node);
      }catch(error){
        routing.push({teacherId:teacher.teacherId,family:teacher.family,eligible:false,lane,reason:['teacher_provider_error'],error:String(error?.message||error)});
        continue;
      }
      const list=Array.isArray(rows)?rows:(rows?[rows]:[]);
      for(const row of list){
        if(!row||typeof row!=='object') continue;
        oracles.push({
          ...row,
          oracleId:String(row.oracleId||teacher.teacherId),
          source:String(row.source||teacher.source),
          family:String(row.family||teacher.family),
          domain:row.domain||teacher.domain,
        });
      }
      routing.push({teacherId:teacher.teacherId,family:teacher.family,eligible:true,lane,produced:list.length});
    }
    return {oracles,routing,lane};
  }

  return {
    version:'cash-pro-lab-teacher-registry-v1',
    teachers:registry.map(({provider,...teacher})=>teacher),
    provider,
  };
}

export function createRegistryOracleProvider(registry){
  if(!registry||typeof registry.provider!=='function') throw new TypeError('registry provider is required');
  return async node=>(await registry.provider(node)).oracles;
}

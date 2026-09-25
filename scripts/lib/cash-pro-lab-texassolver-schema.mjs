const finite=v=>typeof v==='number'&&Number.isFinite(v);

function object(value){return value!==null&&!Array.isArray(value)&&typeof value==='object';}
function pathText(parts){return parts.length?parts.join('.'):'$';}

export function inspectTexasSolverJson(value,{maxExamples=12}={}){
  const report={
    version:'cash-pro-lab-texassolver-schema-inspector-v1',
    rootType:Array.isArray(value)?'array':value===null?'null':typeof value,
    totalObjects:0,
    totalArrays:0,
    nodeTypes:{},
    actionNodes:0,
    chanceNodes:0,
    terminalNodes:0,
    showdownNodes:0,
    actionNodeWithActions:0,
    actionNodeWithStrategy:0,
    actionNodeWithEvs:0,
    strategyCombos:0,
    evCombos:0,
    strategyShapeErrors:0,
    evShapeErrors:0,
    examples:[],
    fields:new Set(),
  };
  const seen=new Set();
  function visit(node,path=[]){
    if(Array.isArray(node)){
      report.totalArrays++;
      for(let i=0;i<node.length;i++) visit(node[i],[...path,`[${i}]`]);
      return;
    }
    if(!object(node)) return;
    if(seen.has(node)) return;
    seen.add(node);
    report.totalObjects++;
    for(const key of Object.keys(node)) report.fields.add(key);
    const type=typeof node.node_type==='string'?node.node_type:null;
    if(type){
      report.nodeTypes[type]=(report.nodeTypes[type]||0)+1;
      if(type==='action_node'){
        report.actionNodes++;
        const actions=Array.isArray(node.actions)?node.actions:null;
        const strategy=object(node.strategy)?node.strategy:null;
        const evs=object(node.evs)?node.evs:null;
        if(actions?.length) report.actionNodeWithActions++;
        if(strategy){
          report.actionNodeWithStrategy++;
          const rows=Object.entries(strategy);
          report.strategyCombos+=rows.length;
          for(const [,weights] of rows){
            if(!Array.isArray(weights)||!actions||weights.length!==actions.length||weights.some(x=>!finite(Number(x)))) report.strategyShapeErrors++;
          }
        }
        if(evs){
          report.actionNodeWithEvs++;
          const rows=Object.entries(evs);
          report.evCombos+=rows.length;
          for(const [,values] of rows){
            if(!Array.isArray(values)||!actions||values.length!==actions.length||values.some(x=>!finite(Number(x)))) report.evShapeErrors++;
          }
        }
        if(report.examples.length<maxExamples){
          report.examples.push({path:pathText(path),node_type:type,player:node.player??null,actions:actions||null,strategyCombos:strategy?Object.keys(strategy).length:0,evCombos:evs?Object.keys(evs).length:0});
        }
      }else if(type==='chance_node') report.chanceNodes++;
      else if(type==='terminal_node') report.terminalNodes++;
      else if(type==='showdown_node') report.showdownNodes++;
    }
    for(const [key,child] of Object.entries(node)){
      if(key==='strategy'||key==='evs') continue;
      if(object(child)||Array.isArray(child)) visit(child,[...path,key]);
    }
  }
  visit(value,[]);
  report.fields=[...report.fields].sort();
  report.hasStrategy=report.actionNodeWithStrategy>0;
  report.hasEvs=report.actionNodeWithEvs>0;
  report.strategyStructureHealthy=report.hasStrategy&&report.strategyShapeErrors===0;
  report.evStructureHealthy=report.hasEvs&&report.evShapeErrors===0;
  report.oracleReady=false;
  report.certifiedStudy=false;
  report.note='Schema inspection is descriptive only. Presence of strategy/EV fields does not prove node identity, units, convergence, action mapping, teacher independence or study certification.';
  return report;
}

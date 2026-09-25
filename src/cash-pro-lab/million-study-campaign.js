import { strategicCurriculumManifest, iterateStrategicCurriculum } from './strategic-curriculum.js';

export const MILLION_STUDY_CAMPAIGN_V1=Object.freeze({
  version:'cash-pro-lab-million-campaign-v1',
  seed:'cash-pro-lab-million-v1',
  split:Object.freeze({train:80,dev:10,holdout:10}),
  minimumPlannedTickets:3_000_000,
  purpose:'offline-replay-postgame-study',
  rules:Object.freeze({
    trainMayInfluencePolicy:true,
    devMayTuneThresholds:true,
    holdoutMayInfluencePolicy:false,
    holdoutMayTuneThresholds:false,
    holdoutIsPromotionOnly:true,
    autoPromote:false,
    ticketsAreNotStudies:true,
    onlyCertifiedNodesCountAsStudies:true,
    preflopHasNoBoardTextureAxis:true,
    postflopHeadsUpUsesOrderedMatchups:true,
    multiwayStartsAtThreePlayers:true,
  }),
});

const fnvStep=(hash,text)=>{
  let h=hash>>>0;
  for(let i=0;i<text.length;i++){
    h^=text.charCodeAt(i);
    h=Math.imul(h,0x01000193)>>>0;
  }
  return h>>>0;
};

export function createMillionStudyManifest(overrides={}){
  const options={
    seed:overrides.seed??MILLION_STUDY_CAMPAIGN_V1.seed,
    split:overrides.split??MILLION_STUDY_CAMPAIGN_V1.split,
    plans:overrides.plans??{},
  };
  const curriculum=strategicCurriculumManifest(options);
  const errors=[];
  if(curriculum.tickets<MILLION_STUDY_CAMPAIGN_V1.minimumPlannedTickets) errors.push('campaign_below_million_scale_floor');
  for(const lane of ['preflop','postflop-heads-up','postflop-multiway']){
    if(!(curriculum.lanes?.[lane]?.tickets>0)) errors.push(`lane_missing:${lane}`);
  }
  return {
    version:MILLION_STUDY_CAMPAIGN_V1.version,
    purpose:MILLION_STUDY_CAMPAIGN_V1.purpose,
    curriculum,
    rules:{...MILLION_STUDY_CAMPAIGN_V1.rules},
    valid:errors.length===0,
    errors,
    honestClaim:`${curriculum.tickets} planned strategic curriculum tickets across ${curriculum.cells} strategic cells; zero are counted as completed studies until they pass exact-state Understanding Proof, teacher-domain verification, independent-oracle consensus and EV audit.`,
  };
}

export function auditMillionCampaignEnumeration(overrides={}){
  const manifest=createMillionStudyManifest(overrides);
  const options={
    seed:manifest.curriculum.seed,
    split:manifest.curriculum.split,
    plans:overrides.plans??{},
  };
  const splits={train:0,dev:0,holdout:0};
  const lanes={preflop:0,'postflop-heads-up':0,'postflop-multiway':0};
  let tickets=0,cells=0,lastCell=null,ordinalErrors=0,checksum=0x811c9dc5;
  for(const ticket of iterateStrategicCurriculum(options)){
    if(ticket.ordinal!==tickets) ordinalErrors++;
    tickets++;
    if(ticket.cellId!==lastCell){cells++;lastCell=ticket.cellId;}
    if(Object.hasOwn(splits,ticket.split)) splits[ticket.split]++;
    else splits[ticket.split]=(splits[ticket.split]||0)+1;
    if(Object.hasOwn(lanes,ticket.teacherLane)) lanes[ticket.teacherLane]++;
    else lanes[ticket.teacherLane]=(lanes[ticket.teacherLane]||0)+1;
    checksum=fnvStep(checksum,`${ticket.ordinal}|${ticket.cellId}|${ticket.sampleIndex}|${ticket.sampleSeed}|${ticket.split}|${ticket.teacherLane};`);
  }
  const errors=[];
  if(tickets!==manifest.curriculum.tickets) errors.push('ticket_count_mismatch');
  if(cells!==manifest.curriculum.cells) errors.push('cell_count_mismatch');
  if(ordinalErrors) errors.push('ordinal_discontinuity');
  for(const lane of ['preflop','postflop-heads-up','postflop-multiway']){
    if((lanes[lane]||0)!==(manifest.curriculum.lanes?.[lane]?.tickets||0)) errors.push(`lane_count_mismatch:${lane}`);
  }
  return {
    version:'cash-pro-lab-million-campaign-audit-v2',
    valid:manifest.valid&&errors.length===0,
    manifest,
    ticketsEnumerated:tickets,
    strategicCellsEnumerated:cells,
    splits,
    teacherLanes:lanes,
    ordinalErrors,
    checksum:checksum.toString(16).padStart(8,'0'),
    errors:[...manifest.errors,...errors],
    note:'This exhaustively audits the strategic curriculum enumeration. It does not claim solver-certified studies were completed; certification accounting remains separate and only STUDIED nodes count.',
  };
}

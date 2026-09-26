export const LOCAL_SOLVE_WORKER_GUARDS=Object.freeze({
  pilot:Object.freeze({minTotalMemGB:24,minFreeMemGB:16,minFreeDiskGB:10}),
  campaign:Object.freeze({minFreeDiskGB:100}),
});

function finite(v){return typeof v==='number'&&Number.isFinite(v);}
function round1(v){return Number(v.toFixed(1));}

export function evaluateLocalSolveWorkerHardware({logicalCpus,totalMemGB,freeMemGB,freeDiskGB}={}){
  const errors=[];
  for(const [key,value] of Object.entries({logicalCpus,totalMemGB,freeMemGB,freeDiskGB})){
    if(!finite(value)||value<=0) errors.push(`${key}_invalid`);
  }
  if(errors.length) return {ok:false,errors,pilot:{allowed:false,reasons:['hardware_metrics_invalid']},campaign:{allowed:false,reasons:['hardware_metrics_invalid']}};

  const pilotReasons=[];
  if(totalMemGB<LOCAL_SOLVE_WORKER_GUARDS.pilot.minTotalMemGB) pilotReasons.push(`total_memory_below_${LOCAL_SOLVE_WORKER_GUARDS.pilot.minTotalMemGB}gb_guard`);
  if(freeMemGB<LOCAL_SOLVE_WORKER_GUARDS.pilot.minFreeMemGB) pilotReasons.push(`free_memory_below_${LOCAL_SOLVE_WORKER_GUARDS.pilot.minFreeMemGB}gb_guard`);
  if(freeDiskGB<LOCAL_SOLVE_WORKER_GUARDS.pilot.minFreeDiskGB) pilotReasons.push(`free_disk_below_${LOCAL_SOLVE_WORKER_GUARDS.pilot.minFreeDiskGB}gb_guard`);

  const campaignReasons=['production_pilot_must_pass_first'];
  if(freeDiskGB<LOCAL_SOLVE_WORKER_GUARDS.campaign.minFreeDiskGB) campaignReasons.push(`free_disk_below_${LOCAL_SOLVE_WORKER_GUARDS.campaign.minFreeDiskGB}gb_campaign_guard`);

  return {
    ok:true,
    errors:[],
    hardware:{logicalCpus:Math.trunc(logicalCpus),totalMemGB:round1(totalMemGB),freeMemGB:round1(freeMemGB),freeDiskGB:round1(freeDiskGB)},
    recommendation:{pilotThreads:1,campaignThreads:Math.max(1,Math.min(8,Math.floor(logicalCpus/2)))},
    pilot:{allowed:pilotReasons.length===0,reasons:pilotReasons},
    campaign:{allowed:false,reasons:campaignReasons},
    note:'These are conservative operational guards, not claims that a given RAM size guarantees a full-flop solve. The real production pilot is the authority for this machine.',
  };
}

export function unlockCampaignAfterPilot(report,{pilotPassed=false}={}){
  if(!report?.ok) return {allowed:false,reasons:['hardware_report_invalid']};
  const reasons=[];
  if(!pilotPassed) reasons.push('production_pilot_not_passed');
  if(report.hardware.freeDiskGB<LOCAL_SOLVE_WORKER_GUARDS.campaign.minFreeDiskGB) reasons.push(`free_disk_below_${LOCAL_SOLVE_WORKER_GUARDS.campaign.minFreeDiskGB}gb_campaign_guard`);
  return {allowed:reasons.length===0,reasons};
}

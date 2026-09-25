import {createPlayerModel,observe,addHand,profileSnapshot,exploitWeight} from './player-model.mjs';
import {playerIdentityFromVisibleName,unresolvedIdentity} from './player-identity.mjs';

const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));

function createProfile(identity){
  return {
    playerId:identity.playerId,
    visibleNames:new Set(identity.visibleName?[identity.visibleName]:[]),
    model:createPlayerModel(),
    lineStats:new Map(),
    evidence:[],
    showdowns:0,
    sessions:new Set(),
    firstSeenAt:null,
    lastSeenAt:null
  };
}

function lineStat(profile,key,prior=.5,priorStrength=16){
  if(!profile.lineStats.has(key)){
    profile.lineStats.set(key,{success:prior*priorStrength,failure:(1-prior)*priorStrength,observed:0});
  }
  return profile.lineStats.get(key);
}

export class PlayerProfileStore{
  constructor({maxEvidencePerPlayer=5000}={}){
    this.version='player-profile-store-v0.6';
    this.maxEvidencePerPlayer=maxEvidencePerPlayer;
    this.profiles=new Map();
    this.seatBindings=new Map(); // sessionId|seatId -> identity
  }

  resolveVisibleName(name,opts={}){ return playerIdentityFromVisibleName(name,opts); }

  bindSeat({sessionId,seatId,visibleName,site='pokerstars',confidence=1,at=null}={}){
    const identity=playerIdentityFromVisibleName(visibleName,{site,confidence});
    const key=`${sessionId??'unknown'}|${seatId??'unknown'}`;
    this.seatBindings.set(key,identity.resolved?identity:unresolvedIdentity(identity.reason));
    if(identity.resolved){
      const p=this.getOrCreate(identity);
      p.sessions.add(String(sessionId??'unknown'));
      p.visibleNames.add(identity.visibleName);
      p.firstSeenAt=p.firstSeenAt??at;
      p.lastSeenAt=at??p.lastSeenAt;
    }
    return identity;
  }

  unbindSeat({sessionId,seatId}={}){ this.seatBindings.delete(`${sessionId??'unknown'}|${seatId??'unknown'}`); }

  identityAtSeat({sessionId,seatId}={}){
    return this.seatBindings.get(`${sessionId??'unknown'}|${seatId??'unknown'}`) || unresolvedIdentity('seat_unbound');
  }

  getOrCreate(identity){
    if(!identity?.resolved||!identity.playerId) throw new Error('resolved_identity_required');
    if(!this.profiles.has(identity.playerId)) this.profiles.set(identity.playerId,createProfile(identity));
    return this.profiles.get(identity.playerId);
  }

  profileForIdentity(identity){ return identity?.resolved?this.profiles.get(identity.playerId)||null:null; }

  profileForSeat(ctx={}){ return this.profileForIdentity(this.identityAtSeat(ctx)); }

  addHand({identity,sessionId=null,handId=null,at=null,source='replay-ledger'}={}){
    if(!identity?.resolved) return {applied:false,reason:'identity_unresolved'};
    const p=this.getOrCreate(identity); addHand(p.model,1);
    this.#evidence(p,{kind:'hand',sessionId,handId,at,source});
    p.lastSeenAt=at??p.lastSeenAt;
    return {applied:true};
  }

  observeStat({identity,stat,success,weight=1,sessionId=null,handId=null,street=null,source='replay-ledger',at=null}={}){
    if(!identity?.resolved) return {applied:false,reason:'identity_unresolved'};
    const p=this.getOrCreate(identity);
    observe(p.model,stat,Boolean(success),clamp(weight,0,1));
    this.#evidence(p,{kind:'stat',stat,success:Boolean(success),weight:clamp(weight,0,1),sessionId,handId,street,source,at});
    p.lastSeenAt=at??p.lastSeenAt;
    return {applied:true};
  }

  observeLine({identity,key,success,weight=1,prior=.5,priorStrength=16,sessionId=null,handId=null,street=null,source='showdown',at=null}={}){
    if(!identity?.resolved) return {applied:false,reason:'identity_unresolved'};
    const p=this.getOrCreate(identity),s=lineStat(p,key,prior,priorStrength),w=clamp(weight,0,1);
    if(success)s.success+=w;else s.failure+=w;s.observed+=w;
    if(source==='showdown')p.showdowns++;
    this.#evidence(p,{kind:'line',key,success:Boolean(success),weight:w,sessionId,handId,street,source,at});
    p.lastSeenAt=at??p.lastSeenAt;
    return {applied:true};
  }

  lineEstimate(identity,key){
    const p=this.profileForIdentity(identity); if(!p)return null;
    const s=p.lineStats.get(key); if(!s)return null;
    const total=s.success+s.failure;
    return {mean:total?s.success/total:.5,observations:s.observed,confidence:clamp(s.observed/(s.observed+30))};
  }

  snapshot(identity){
    const p=this.profileForIdentity(identity);
    if(!p) return {resolved:Boolean(identity?.resolved),available:false,playerId:identity?.playerId??null,exploitWeight:0};
    const base=profileSnapshot(p.model);
    const lineStats={}; for(const [k] of p.lineStats) lineStats[k]=this.lineEstimate(identity,k);
    return {
      resolved:true,available:true,playerId:p.playerId,visibleNames:[...p.visibleNames],sessions:[...p.sessions],
      showdowns:p.showdowns,firstSeenAt:p.firstSeenAt,lastSeenAt:p.lastSeenAt,
      base,exploitWeight:exploitWeight(p.model),lineStats,evidenceCount:p.evidence.length
    };
  }

  #evidence(profile,row){
    profile.evidence.push({...row});
    if(profile.evidence.length>this.maxEvidencePerPlayer) profile.evidence.splice(0,profile.evidence.length-this.maxEvidencePerPlayer);
  }
}

export function showdownLineObservations({actions=[],holeCards=[],board=[]}={}){
  const rows=[];
  const river=actions.filter(x=>String(x.street).toLowerCase()==='river');
  const last=river.at(-1);
  if(last && ['BET','RAISE','ALLIN'].includes(String(last.action).toUpperCase())){
    const size=Number(last.sizePct??0);
    if(size>=75) rows.push({key:'river_large_bet_reaches_showdown',success:true,weight:1});
    if(size>=100) rows.push({key:'river_overbet_reaches_showdown',success:true,weight:1});
  }
  if(holeCards.length===2 && board.length===5) rows.push({key:'showdown_observed',success:true,weight:1});
  return rows;
}

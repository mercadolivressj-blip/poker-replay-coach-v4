import {assertValidPushFoldSuite} from './pushfold-suite-integrity.js';
import {registerPack,clearPacks} from './pack-registry.js';

export function registerVerifiedPushFoldSuite(suite,{clearExisting=false}={}){
 const validation=assertValidPushFoldSuite(suite,{requireHash:true});
 if(clearExisting)clearPacks();
 const keys=[];
 for(const p of suite.packs)keys.push(registerPack({...p.meta,suiteSha256:suite.suiteSha256},p.chart));
 return{registered:keys.length,keys,suiteSha256:suite.suiteSha256,snapshotSha256:suite.snapshotSha256,depths:[...validation.depths],certification:suite.certification};
}

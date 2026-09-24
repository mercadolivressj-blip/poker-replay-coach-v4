export const POSITION_MAP=Object.freeze({
  6:['UTG','HJ','CO','BTN','SB','BB'],
  7:['UTG','MP','HJ','CO','BTN','SB','BB'],
  8:['UTG','UTG1','LJ','HJ','CO','BTN','SB','BB'],
  9:['UTG','UTG1','MP','LJ','HJ','CO','BTN','SB','BB']
});

export function positionsFor(tableSize){
  const n=Number(tableSize);
  if(!POSITION_MAP[n])throw new Error(`table_size_unsupported:${tableSize}`);
  return [...POSITION_MAP[n]];
}

export function normalizePosition(pos){
  const x=String(pos||'').trim().toUpperCase().replace(/\s+/g,'');
  const a={BU:'BTN',BUTTON:'BTN',SMALLBLIND:'SB',BIGBLIND:'BB','UTG+1':'UTG1',UTG_1:'UTG1',MIDDLE:'MP',LOJACK:'LJ',HIJACK:'HJ',CUTOFF:'CO'};
  return a[x]||x;
}

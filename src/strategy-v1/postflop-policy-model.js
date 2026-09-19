import c0 from './postflop-policy-model/chunk-000.js';
import c1 from './postflop-policy-model/chunk-001.js';
import c2 from './postflop-policy-model/chunk-002.js';
import c3 from './postflop-policy-model/chunk-003.js';
import c4 from './postflop-policy-model/chunk-004.js';
import c5 from './postflop-policy-model/chunk-005.js';
import c6 from './postflop-policy-model/chunk-006.js';
import c7 from './postflop-policy-model/chunk-007.js';
import c8 from './postflop-policy-model/chunk-008.js';
import c9 from './postflop-policy-model/chunk-009.js';
import c10 from './postflop-policy-model/chunk-010.js';
import c11 from './postflop-policy-model/chunk-011.js';

export const POSTFLOP_POLICY_V4_RAW = [c0,c1,c2,c3,c4,c5,c6,c7,c8,c9,c10,c11].join('');
export const POSTFLOP_POLICY_V4_MODEL = JSON.parse(POSTFLOP_POLICY_V4_RAW);
export default POSTFLOP_POLICY_V4_MODEL;

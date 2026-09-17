import assert from 'node:assert/strict';
import { shouldAcceptOcrAction } from '../src/core/action-ocr-gate.js';

assert.equal(shouldAcceptOcrAction({action:'CALL',confidence:.61,cardPresent:true,raw:'Pago'}).ok,true);
assert.equal(shouldAcceptOcrAction({action:'RAISE',confidence:.55,cardPresent:true,raw:'Aumento'}).ok,true);
assert.equal(shouldAcceptOcrAction({action:'ALLIN',confidence:.61,cardPresent:true,raw:'All In'}).ok,false,'low-confidence ALLIN must be rejected');
assert.equal(shouldAcceptOcrAction({action:'ALLIN',confidence:.82,cardPresent:true,raw:'All In'}).ok,true);
assert.equal(shouldAcceptOcrAction({action:'CHECK',confidence:.9,cardPresent:false,raw:'Passo'}).ok,false,'empty/showdown seat cannot emit OCR action');
assert.equal(shouldAcceptOcrAction({action:'FOLD',confidence:.99,cardPresent:true,raw:'Desisto'}).ok,false,'fold belongs to card detector');
assert.equal(shouldAcceptOcrAction({action:'RAISE',confidence:.9,cardPresent:true,raw:'Lugar Vazio'}).ok,false);
assert.equal(shouldAcceptOcrAction({action:'CALL',confidence:.9,cardPresent:true,raw:'Venceu US$ 1,84'}).ok,false);
console.log('action-ocr-gate-v1 regressions: OK');

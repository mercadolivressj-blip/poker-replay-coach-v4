import { activeHandMachine } from '../core/state-machine.js';

function patchOpponentCopy() {
  const title = document.getElementById('proOpponentTitle');
  const meta = document.getElementById('proOpponentMeta');
  const reasons = document.getElementById('proOpponentReasons');
  if (title && /ative a vision/i.test(title.textContent || '')) {
    title.textContent = 'Aguardando ação explícita do rival';
    if (meta) meta.textContent = 'Range oculto · histórico local + observações do replay';
    if (reasons && !reasons.textContent?.trim()) reasons.textContent = 'O Coach só usa ações que conseguiu observar; sem evidência, a confiança cai.';
  }
}

function clearStaleConfidence() {
  const machine = activeHandMachine;
  if (!machine || machine.state?.heroToAct) return;
  const confidence = document.getElementById('confidence');
  const decision = document.getElementById('decisionText');
  if (confidence && (!decision || decision.textContent?.trim() === '—' || /aguardando/i.test(decision.textContent || ''))) {
    confidence.textContent = '—';
  }
}

function patchUi() {
  patchOpponentCopy();
  clearStaleConfidence();
}

const observer = new MutationObserver(() => patchUi());
observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
patchUi();
setInterval(patchUi, 120);

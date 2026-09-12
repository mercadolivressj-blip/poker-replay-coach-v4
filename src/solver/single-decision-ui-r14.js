import { activeHandMachine } from '../core/state-machine.js';
import { getDecision } from '../core/decision-store.js';

const STRATEGIC = new Set(['PAGAR','DESISTIR','PASSAR','APOSTAR','AUMENTAR','ALL-IN']);
let painting = false;

function $(id) { return document.getElementById(id); }

function render() {
  if (painting) return;
  const machine = activeHandMachine;
  const decision = $('decisionText');
  const reason = $('decisionReason');
  const details = $('decisionDetails');
  const confidence = $('confidence');
  if (!machine || !decision || !reason || !details || !confidence) return;

  painting = true;
  try {
    const current = getDecision();
    if (!machine.state?.heroToAct) {
      decision.textContent = '—';
      reason.textContent = 'Aguardando sua vez.';
      details.textContent = '';
      confidence.textContent = '—';
      return;
    }

    if (!current) {
      decision.textContent = 'ANALISANDO';
      reason.textContent = 'Fechando o snapshot e o contexto desta decisão.';
      details.textContent = 'A caixa estratégica é controlada por uma única fonte; o classificador antigo não pode mais publicar uma ação paralela.';
      confidence.textContent = '—';
      return;
    }

    decision.textContent = current.decision || 'ANALISANDO';
    reason.textContent = current.reason || 'Analisando a decisão atual.';
    details.textContent = Array.isArray(current.details) ? current.details.join(' · ') : String(current.details || '');
    confidence.textContent = Number(current.confidence) > 0 ? `${Math.round(Number(current.confidence))}%` : '—';

    if (STRATEGIC.has(current.decision)) {
      decision.dataset.final = 'true';
    } else {
      delete decision.dataset.final;
    }
  } finally {
    painting = false;
  }
}

const target = document.querySelector('.decision-box') || document.querySelector('.coach-card') || document.body;
if (target && typeof MutationObserver !== 'undefined') {
  const observer = new MutationObserver(() => render());
  observer.observe(target, { subtree: true, childList: true, characterData: true });
}

if (typeof window !== 'undefined') {
  window.addEventListener('prc:decision', render);
  window.__prcSingleDecisionUiR14 = { enabled: true, source: 'decision-store-only' };
}

setInterval(render, 30);
setTimeout(render, 0);

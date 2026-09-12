import { activeHandMachine } from '../core/state-machine.js';
import { getDecision } from '../core/decision-store.js';

const STRATEGIC = new Set(['PAGAR','DESISTIR','PASSAR','APOSTAR','AUMENTAR','ALL-IN']);
let painting = false;

function $(id) { return document.getElementById(id); }
function setText(el, value) {
  if (!el) return;
  const next = String(value ?? '');
  if (el.textContent !== next) el.textContent = next;
}
function setFinal(el, enabled) {
  if (!el) return;
  if (enabled) {
    if (el.dataset.final !== 'true') el.dataset.final = 'true';
  } else if ('final' in el.dataset) {
    delete el.dataset.final;
  }
}

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
      setText(decision, '—');
      setText(reason, 'Aguardando sua vez.');
      setText(details, '');
      setText(confidence, '—');
      setFinal(decision, false);
      return;
    }

    if (!current) {
      setText(decision, 'ANALISANDO');
      setText(reason, 'Fechando o snapshot e o contexto desta decisão.');
      setText(details, 'A caixa estratégica é controlada somente pelo decision-store R14.');
      setText(confidence, '—');
      setFinal(decision, false);
      return;
    }

    setText(decision, current.decision || 'ANALISANDO');
    setText(reason, current.reason || 'Analisando a decisão atual.');
    setText(details, Array.isArray(current.details) ? current.details.join(' · ') : String(current.details || ''));
    setText(confidence, Number(current.confidence) > 0 ? `${Math.round(Number(current.confidence))}%` : '—');
    setFinal(decision, STRATEGIC.has(current.decision));
  } finally {
    painting = false;
  }
}

// The legacy renderer is isolated before main.js is imported, so this module no
// longer needs a MutationObserver. Event-driven rendering plus a low-frequency
// watchdog avoids DOM feedback loops and keeps the tab responsive during long replays.
if (typeof window !== 'undefined') {
  window.addEventListener('prc:decision', render);
  window.addEventListener('prc:generation-change', render);
  window.__prcSingleDecisionUiR14 = {
    enabled: true,
    source: 'decision-store-only',
    idempotent: true,
    mutationObserver: false,
    legacyUiIsolated: true,
  };
}

setInterval(render, 160);
setTimeout(render, 0);

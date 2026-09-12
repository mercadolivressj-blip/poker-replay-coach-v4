import { activeHandMachine } from '../core/state-machine.js';

let promptedHandId = 0;

function heroReady() {
  const authority = typeof window !== 'undefined' ? window.__prcManualHeroAuthorityR14 : null;
  const cards = activeHandMachine?.state?.hero || [];
  return Boolean(
    authority?.heroLocked
    && authority.handId === activeHandMachine?.handId
    && cards.length === 2
    && cards.every((card) => card?.rank && card?.suit)
  );
}

function markManualUi() {
  const metric = document.querySelector('.metric-editable[data-manual-target="hero"]');
  if (!metric) return null;
  const label = metric.querySelector('span');
  if (label && !label.dataset.manualOnlyR14) {
    label.dataset.manualOnlyR14 = '1';
    const edit = label.querySelector('em');
    label.textContent = 'SUAS CARTAS · MANUAL ';
    if (edit) label.append(edit);
  }
  metric.title = 'Informe manualmente suas duas cartas nesta mão';
  metric.setAttribute('aria-label', 'Informar manualmente suas duas cartas');
  return metric;
}

function promptCurrentHand() {
  if (typeof document === 'undefined') return;
  const handId = Number(activeHandMachine?.handId) || 0;
  if (handId <= 0 || promptedHandId === handId || heroReady()) return;
  const metric = markManualUi();
  if (!metric) return;
  const panel = document.getElementById('manualPanel');
  if (panel && !panel.classList.contains('hidden')) return;
  promptedHandId = handId;
  metric.click();
}

if (typeof window !== 'undefined') {
  window.addEventListener('prc:generation-change', (event) => {
    const handId = Number(event.detail?.generation) || Number(activeHandMachine?.handId) || 0;
    if (handId > 0) promptedHandId = Math.min(promptedHandId, handId - 1);
    setTimeout(promptCurrentHand, 80);
  });

  window.addEventListener('prc:manual-state-applied', (event) => {
    if (!event.detail?.hero) return;
    promptedHandId = Number(event.detail.generation) || Number(activeHandMachine?.handId) || promptedHandId;
  });

  window.__prcPromptManualHeroR14 = promptCurrentHand;
}

setInterval(() => {
  markManualUi();
  promptCurrentHand();
}, 220);

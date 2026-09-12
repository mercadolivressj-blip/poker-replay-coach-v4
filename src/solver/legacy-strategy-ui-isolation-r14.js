const IDS = ['decisionText', 'decisionReason', 'decisionDetails', 'confidence'];
const real = new Map();
const dummies = new Map();
let restored = false;

function prepare() {
  if (typeof document === 'undefined') return;
  for (const id of IDS) {
    const node = document.getElementById(id);
    if (!node) continue;
    real.set(id, node);
    node.id = `${id}R14Owned`;

    const dummy = document.createElement(node.tagName || 'div');
    dummy.id = id;
    dummy.hidden = true;
    dummy.setAttribute('aria-hidden', 'true');
    dummy.dataset.legacyStrategySinkR14 = 'true';
    document.body.appendChild(dummy);
    dummies.set(id, dummy);
  }
}

export function restoreR14DecisionUi() {
  if (restored || typeof document === 'undefined') return;
  restored = true;
  for (const [id, dummy] of dummies) dummy.remove();
  for (const [id, node] of real) node.id = id;
  if (typeof window !== 'undefined') {
    window.__prcLegacyStrategyUiIsolationR14 = {
      enabled: true,
      restored: true,
      isolatedIds: [...real.keys()],
    };
  }
}

prepare();

if (typeof window !== 'undefined') {
  window.__prcLegacyStrategyUiIsolationR14 = {
    enabled: true,
    restored: false,
    isolatedIds: [...real.keys()],
  };
}

function ensureStatus() {
  const box = document.getElementById('proOpponentBox');
  if (!box) return null;
  let el = document.getElementById('tableVisionStatus');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tableVisionStatus';
    el.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px solid #263136;color:#7f9399;font-size:10px;font-weight:800;letter-spacing:.04em';
    box.appendChild(el);
  }
  return el;
}

function label(observer) {
  if (!observer) return 'MESA VISUAL · iniciando';
  if (observer.busy) return 'MESA VISUAL · lendo mesa…';
  if (observer.lastError) return `MESA VISUAL · ${observer.lastError}`;
  const last = observer.last;
  if (last) {
    const seats = Array.isArray(last.seats) ? last.seats.length : 0;
    const ms = Number.isFinite(last.ms) ? ` · ${last.ms}ms` : '';
    return `MESA VISUAL · ${seats} assentos observados${ms}`;
  }
  return observer.enabled ? 'MESA VISUAL · aguardando snapshot' : 'MESA VISUAL · indisponível';
}

function tick() {
  const el = ensureStatus();
  if (!el) return;
  el.textContent = label(window.__prcTableObserver || null);
}

setInterval(tick, 350);
setTimeout(tick, 0);

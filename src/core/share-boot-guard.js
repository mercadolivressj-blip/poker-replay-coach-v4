let mainReady = false;
let mainError = null;

if (typeof window !== 'undefined') {
  window.__prcMarkMainReady = () => { mainReady = true; mainError = null; };
  window.__prcMarkMainError = (error) => { mainReady = false; mainError = error?.message || String(error || 'runtime error'); };
}

function button() { return document.getElementById('shareBtn'); }
function reason() { return document.getElementById('decisionReason'); }

function paintError(text) {
  const btn = button();
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Compartilhar replay';
  }
  const r = reason();
  if (r) r.textContent = text;
}

function install() {
  const btn = button();
  if (!btn || btn.dataset.bootGuard === '1') return;
  btn.dataset.bootGuard = '1';
  btn.addEventListener('click', () => {
    const old = btn.textContent;
    btn.textContent = 'Abrindo seletor…';
    setTimeout(() => {
      if (mainReady) {
        if (btn.textContent === 'Abrindo seletor…') btn.textContent = old || 'Compartilhar replay';
        return;
      }
      paintError(mainError ? `Runtime não carregou: ${mainError}` : 'Runtime ainda não carregou. Recarregue esta página.');
    }, 900);
  }, { capture: true });
}

install();
setTimeout(install, 0);
setTimeout(install, 250);

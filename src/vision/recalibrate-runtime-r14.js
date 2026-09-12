const diagnostics = {
  clicks: 0,
  accepted: 0,
  ignoredNoSource: 0,
  lastGeneration: null,
  lastAt: null,
};
if (typeof window !== 'undefined') window.__prcRecalibrateR14 = diagnostics;

function hasVisibleSource() {
  const video = document.getElementById('video');
  if (video && video.style.display !== 'none' && video.readyState >= 2 && video.videoWidth > 0) return true;
  const image = document.getElementById('image');
  return Boolean(image && image.style.display !== 'none' && image.complete && image.naturalWidth > 0);
}

function install() {
  if (typeof document === 'undefined') return;
  const button = document.getElementById('recalibrateBtn');
  if (!button || button.__prcInstalled) return;
  button.__prcInstalled = true;

  button.addEventListener('click', () => {
    diagnostics.clicks++;
    const original = button.dataset.defaultLabel || '↻ Refresh leitura';
    if (!hasVisibleSource()) {
      diagnostics.ignoredNoSource++;
      button.textContent = 'Abra um replay primeiro';
      setTimeout(() => { button.textContent = original; }, 900);
      return;
    }

    const token = typeof window.__prcRecalibrateReading === 'function'
      ? window.__prcRecalibrateReading()
      : null;
    if (!token) return;

    diagnostics.accepted++;
    diagnostics.lastGeneration = token.generation;
    diagnostics.lastAt = Date.now();
    button.disabled = true;
    button.textContent = 'Relendo…';
    setTimeout(() => {
      button.disabled = false;
      button.textContent = original;
    }, 1000);
  });
}

install();

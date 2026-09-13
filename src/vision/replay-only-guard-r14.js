const state = {
  enabled: true,
  fileReady: false,
  sourceKind: null,
  fileName: null,
  loadedAt: 0,
};

function updateBadge() {
  const badge = document.getElementById('modeBadge');
  if (!badge) return;
  badge.textContent = state.fileReady ? 'REPLAY · ARQUIVO' : 'REPLAY · SOMENTE ARQUIVO';
  badge.classList.add('ok');
}

function installShareGuard() {
  const share = document.getElementById('shareBtn');
  if (!share) return;
  share.textContent = 'Replay por arquivo';
  share.disabled = true;
  share.title = 'R14 de estudo aceita somente vídeo/imagem gravados. Captura de tela ao vivo fica desativada.';
  share.onclick = (event) => {
    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();
  };
}

function installFileTracking() {
  const input = document.getElementById('fileInput');
  if (!input) return;
  input.addEventListener('change', () => {
    const file = input.files?.[0] || null;
    state.fileReady = Boolean(file && (file.type.startsWith('video/') || file.type.startsWith('image/')));
    state.sourceKind = !file ? null : file.type.startsWith('image/') ? 'image-file' : 'video-file';
    state.fileName = file?.name || null;
    state.loadedAt = state.fileReady ? Date.now() : 0;
    updateBadge();
    window.dispatchEvent(new CustomEvent('prc:replay-file-source', { detail: { ...state } }));
  }, true);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.__prcReplayOnlyR14 = state;
  installShareGuard();
  installFileTracking();
  updateBadge();
}

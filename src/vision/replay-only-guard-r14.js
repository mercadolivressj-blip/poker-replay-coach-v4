const state = {
  enabled: true,
  fileReady: false,
  screenReplayReady: false,
  sourceKind: null,
  fileName: null,
  loadedAt: 0,
};

function emitSource() {
  window.dispatchEvent(new CustomEvent('prc:replay-source', { detail: { ...state } }));
}

function updateBadge() {
  const badge = document.getElementById('modeBadge');
  if (!badge) return;
  if (state.sourceKind === 'screen-replay') badge.textContent = 'REPLAY · TELA COMPARTILHADA';
  else if (state.fileReady) badge.textContent = 'REPLAY · ARQUIVO';
  else if (state.sourceKind === 'screen-replay-pending') badge.textContent = 'REPLAY · SELECIONANDO TELA';
  else badge.textContent = 'REPLAY · AGUARDANDO FONTE';
  badge.classList.add('ok');
}

function clearScreenReplay() {
  state.screenReplayReady = false;
  if (state.sourceKind === 'screen-replay' || state.sourceKind === 'screen-replay-pending') {
    state.sourceKind = null;
    state.loadedAt = 0;
  }
  updateBadge();
  emitSource();
}

function installReplayShare() {
  const share = document.getElementById('shareBtn');
  if (!share) return;
  const legacyHandler = share.onclick;

  share.textContent = 'Compartilhar replay';
  share.disabled = false;
  share.title = 'Compartilhe somente uma janela com replay gravado/pós-jogo.';

  share.onclick = async (event) => {
    event?.preventDefault?.();
    const confirmed = window.confirm(
      'Confirma que a janela compartilhada contém somente um replay gravado/pós-jogo e NÃO uma mesa ao vivo?'
    );
    if (!confirmed) return;

    state.fileReady = false;
    state.fileName = null;
    state.screenReplayReady = false;
    state.sourceKind = 'screen-replay-pending';
    state.loadedAt = 0;
    updateBadge();
    emitSource();

    try {
      if (typeof legacyHandler === 'function') await legacyHandler.call(share, event);
      const video = document.getElementById('video');
      const stream = video?.srcObject;
      const tracks = typeof stream?.getVideoTracks === 'function' ? stream.getVideoTracks() : [];
      const active = tracks.some((track) => track?.readyState === 'live');
      if (!active) {
        clearScreenReplay();
        return;
      }

      state.screenReplayReady = true;
      state.sourceKind = 'screen-replay';
      state.loadedAt = Date.now();
      updateBadge();
      emitSource();
      tracks.forEach((track) => track.addEventListener('ended', clearScreenReplay, { once: true }));
    } catch {
      clearScreenReplay();
    }
  };
}

function installFileTracking() {
  const input = document.getElementById('fileInput');
  if (!input) return;
  input.addEventListener('change', () => {
    const file = input.files?.[0] || null;
    state.fileReady = Boolean(file && (file.type.startsWith('video/') || file.type.startsWith('image/')));
    state.screenReplayReady = false;
    state.sourceKind = !file ? null : file.type.startsWith('image/') ? 'image-file' : 'video-file';
    state.fileName = file?.name || null;
    state.loadedAt = state.fileReady ? Date.now() : 0;
    updateBadge();
    emitSource();
  }, true);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.__prcReplayOnlyR14 = state;
  installReplayShare();
  installFileTracking();
  updateBadge();
}

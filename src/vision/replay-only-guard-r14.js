const state = {
  enabled: true,
  fileReady: false,
  screenReplayReady: false,
  screenReplayConfirmed: false,
  sourceKind: null,
  fileName: null,
  loadedAt: 0,
};

let shareIntentId = 0;
let pendingSince = 0;
let trackedScreenStream = null;

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

function currentScreenStream() {
  const video = document.getElementById('video');
  const stream = video?.srcObject || null;
  if (!stream || typeof stream.getVideoTracks !== 'function') return null;
  const tracks = stream.getVideoTracks();
  return tracks.some((track) => track?.readyState === 'live') ? stream : null;
}

function publishScreenReplay(stream) {
  if (!stream || !state.screenReplayConfirmed) return false;
  const changed = state.screenReplayReady !== true
    || state.sourceKind !== 'screen-replay'
    || trackedScreenStream !== stream;

  state.fileReady = false;
  state.fileName = null;
  state.screenReplayReady = true;
  state.sourceKind = 'screen-replay';
  state.loadedAt ||= Date.now();
  pendingSince = 0;

  if (trackedScreenStream !== stream) {
    trackedScreenStream = stream;
    const intent = shareIntentId;
    for (const track of stream.getVideoTracks()) {
      track.addEventListener('ended', () => {
        // A stale stream from a previous share must never clear a newer one.
        if (intent !== shareIntentId || trackedScreenStream !== stream) return;
        setTimeout(reconcileScreenReplay, 0);
      }, { once: true });
    }
  }

  if (changed) {
    updateBadge();
    emitSource();
  }
  return true;
}

function clearScreenReplay({ releaseConfirmation = true } = {}) {
  state.screenReplayReady = false;
  trackedScreenStream = null;
  pendingSince = 0;
  if (releaseConfirmation) state.screenReplayConfirmed = false;
  if (state.sourceKind === 'screen-replay' || state.sourceKind === 'screen-replay-pending') {
    state.sourceKind = null;
    state.loadedAt = 0;
  }
  updateBadge();
  emitSource();
}

function reconcileScreenReplay() {
  if (!state.screenReplayConfirmed) return false;
  const stream = currentScreenStream();
  if (stream) return publishScreenReplay(stream);

  if (state.screenReplayReady || state.sourceKind === 'screen-replay') {
    clearScreenReplay({ releaseConfirmation: true });
    return false;
  }

  // getDisplayMedia can take time and the legacy handler may publish srcObject a
  // little after this guard resumes. Keep the user's confirmed replay intent
  // armed instead of falling back to AGUARDANDO FONTE immediately.
  if (state.sourceKind !== 'screen-replay-pending') {
    state.sourceKind = 'screen-replay-pending';
    updateBadge();
    emitSource();
  }
  if (pendingSince && Date.now() - pendingSince > 30000) {
    clearScreenReplay({ releaseConfirmation: true });
  }
  return false;
}

function installReplayShare() {
  const share = document.getElementById('shareBtn');
  if (!share) return;
  const legacyHandler = share.onclick;

  share.textContent = 'Compartilhar replay';
  share.disabled = false;
  share.title = 'Compartilhe somente uma janela/tela reproduzindo um replay gravado/pós-jogo.';

  share.onclick = async (event) => {
    event?.preventDefault?.();
    const confirmed = window.confirm(
      'Confirma que a tela/janela compartilhada está reproduzindo somente um replay gravado/pós-jogo e NÃO uma mesa ao vivo?'
    );
    if (!confirmed) return;

    shareIntentId++;
    pendingSince = Date.now();
    trackedScreenStream = null;
    state.fileReady = false;
    state.fileName = null;
    state.screenReplayConfirmed = true;
    state.screenReplayReady = false;
    state.sourceKind = 'screen-replay-pending';
    state.loadedAt = 0;
    updateBadge();
    emitSource();

    // main.js owns getDisplayMedia. This guard owns only the replay consent and
    // waits until main has actually attached the MediaStream to #video.
    if (typeof legacyHandler === 'function') await legacyHandler.call(share, event);
    reconcileScreenReplay();
  };
}

function installFileTracking() {
  const input = document.getElementById('fileInput');
  if (!input) return;
  input.addEventListener('change', () => {
    const file = input.files?.[0] || null;
    state.fileReady = Boolean(file && (file.type.startsWith('video/') || file.type.startsWith('image/')));
    state.screenReplayConfirmed = false;
    state.screenReplayReady = false;
    trackedScreenStream = null;
    pendingSince = 0;
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
  // Do not rely on a single timing edge after getDisplayMedia. Reconcile the
  // actual MediaStream continuously while the user-confirmed replay share lives.
  setInterval(reconcileScreenReplay, 120);
}

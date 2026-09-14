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
let trackedEnded = false;

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

function hasLiveVideoTrack(stream) {
  if (!stream || typeof stream.getVideoTracks !== 'function') return false;
  return stream.getVideoTracks().some((track) => track?.readyState === 'live');
}

function currentScreenStream() {
  const video = document.getElementById('video');
  const stream = video?.srcObject || null;
  return hasLiveVideoTrack(stream) ? stream : null;
}

function publishScreenReplay(stream) {
  if (!stream || !state.screenReplayConfirmed || !hasLiveVideoTrack(stream)) return false;
  const changed = state.screenReplayReady !== true
    || state.sourceKind !== 'screen-replay'
    || trackedScreenStream !== stream;

  state.fileReady = false;
  state.fileName = null;
  state.screenReplayReady = true;
  state.sourceKind = 'screen-replay';
  state.loadedAt ||= Date.now();
  pendingSince = 0;
  trackedEnded = false;

  if (trackedScreenStream !== stream) {
    trackedScreenStream = stream;
    const intent = shareIntentId;
    for (const track of stream.getVideoTracks()) {
      track.addEventListener('ended', () => {
        if (intent !== shareIntentId || trackedScreenStream !== stream) return;
        trackedEnded = true;
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
  trackedEnded = false;
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

  // Once a confirmed replay stream has been seen, transient srcObject/video
  // timing gaps are NOT allowed to disarm the replay session. The session ends
  // only when the tracked capture track actually ends or the user clicks Parar.
  if (state.screenReplayReady && trackedScreenStream && !trackedEnded) {
    state.sourceKind = 'screen-replay';
    updateBadge();
    return true;
  }

  if (trackedEnded) {
    clearScreenReplay({ releaseConfirmation: true });
    return false;
  }

  if (state.sourceKind !== 'screen-replay-pending') {
    state.sourceKind = 'screen-replay-pending';
    updateBadge();
    emitSource();
  }

  // Only the initial picker/cancel path may time out. A replay that was already
  // published never falls back to AGUARDANDO FONTE because of a transient gap.
  if (!state.screenReplayReady && pendingSince && Date.now() - pendingSince > 30000) {
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
  share.title = 'Compartilhe somente uma janela/tela com o replayer gravado/pós-jogo.';

  share.onclick = async (event) => {
    event?.preventDefault?.();
    const confirmed = window.confirm(
      'Confirma que a tela/janela compartilhada contém somente o REPLAY pós-jogo e NÃO uma mesa ao vivo?'
    );
    if (!confirmed) return;

    shareIntentId++;
    pendingSince = Date.now();
    trackedScreenStream = null;
    trackedEnded = false;
    state.fileReady = false;
    state.fileName = null;
    state.screenReplayConfirmed = true;
    state.screenReplayReady = false;
    state.sourceKind = 'screen-replay-pending';
    state.loadedAt = 0;
    updateBadge();
    emitSource();

    // main.js owns getDisplayMedia. As soon as it attaches a live display track,
    // that capture becomes the latched replay source for this session.
    if (typeof legacyHandler === 'function') await legacyHandler.call(share, event);
    reconcileScreenReplay();
  };
}

function installStopTracking() {
  const stop = document.getElementById('stopBtn');
  if (!stop) return;
  stop.addEventListener('click', () => {
    shareIntentId++;
    clearScreenReplay({ releaseConfirmation: true });
  }, true);
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
    trackedEnded = false;
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
  installStopTracking();
  installFileTracking();
  updateBadge();
  setInterval(reconcileScreenReplay, 120);
}

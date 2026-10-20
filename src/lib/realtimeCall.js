/* Видеозвонки в стиле Zoom: реактивное состояние и полноэкранная видеосцена без прокрутки страницы. */
import { reactive } from 'vue';
import { useAppStore } from '../stores/appStore';

const showToast = (message, error) => useAppStore().toast(message, error);

export const callState = reactive({
  connected: false,
  joining: false,
  audioEnabled: false,
  videoEnabled: false,
  screenShareEnabled: false,
  hasScreenShare: false,
  participantCount: 0,
  layout: 'gallery', // 'gallery' | 'speaker'
  audioBlocked: false,
  statusText: ''
});

export const VideoCall = (() => {
  let meeting = null, sdkPromise, generation = 0;
  const listeners = [], tiles = new Map();
  const $ = id => document.getElementById(id);

  function loadSdk() {
    if (window.RealtimeKitClient) return Promise.resolve(window.RealtimeKitClient);
    if (!sdkPromise) sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@cloudflare/realtimekit@2.0.3/dist/browser.js';
      const timer = setTimeout(() => reject(Error('Истекло время загрузки RealtimeKit')), 20000);
      script.onload = () => { clearTimeout(timer); window.RealtimeKitClient ? resolve(window.RealtimeKitClient) : reject(Error('SDK RealtimeKit недоступен')); };
      script.onerror = () => { clearTimeout(timer); reject(Error('Не удалось загрузить SDK RealtimeKit')); };
      document.head.appendChild(script);
    }).catch(error => { sdkPromise = null; throw error; });
    return sdkPromise;
  }

  function listen(emitter, event, handler) {
    emitter.on(event, handler);
    listeners.push(() => emitter.off(event, handler));
  }

  function stream(element, tracks) {
    const usable = tracks.filter(t => t && t.readyState !== 'ended');
    const old = element.srcObject?.getTracks() || [];
    if (old.length === usable.length && old.every((t, i) => t === usable[i])) return;
    element.srcObject = usable.length ? new MediaStream(usable) : null;
    if (usable.length) {
      element.play().catch(() => {
        callState.audioBlocked = true;
      });
    }
  }

  function initials(name) {
    const parts = String(name || 'Участник').trim().split(/\s+/).slice(0, 2);
    return parts.map(p => p[0]?.toUpperCase() || '').join('') || 'У';
  }

  function tile(key, participant, local, screen, isPrimary) {
    const grid = $('videoGrid');
    if (!grid) return;
    let item = tiles.get(key);
    if (!item) {
      const root = document.createElement('div');
      root.className = 'zoom-tile';
      const video = document.createElement('video');
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      const audio = document.createElement('audio');
      audio.autoplay = true;
      const placeholder = document.createElement('div');
      placeholder.className = 'zoom-avatar-wrap';
      const avatar = document.createElement('div');
      avatar.className = 'zoom-avatar-circle';
      const sub = document.createElement('span');
      sub.className = 'zoom-avatar-name';
      placeholder.append(avatar, sub);
      const badgeBar = document.createElement('div');
      badgeBar.className = 'zoom-tile-bar';
      const label = document.createElement('span');
      label.className = 'zoom-tile-name';
      const micBadge = document.createElement('span');
      micBadge.className = 'zoom-tile-mic';
      badgeBar.append(micBadge, label);
      root.append(video, audio, placeholder, badgeBar);
      grid.appendChild(root);
      item = { root, video, audio, placeholder, avatar, sub, label, micBadge };
      tiles.set(key, item);
    }

    item.root.classList.toggle('mirrored', local && !screen);
    item.root.classList.toggle('screen-share-tile', screen);
    item.root.classList.toggle('primary-tile', Boolean(isPrimary));

    const videoTrack = screen ? participant.screenShareTracks?.video : participant.videoEnabled ? participant.videoTrack : null;
    const audioTrack = screen ? participant.screenShareTracks?.audio : participant.audioEnabled ? participant.audioTrack : null;

    stream(item.video, [videoTrack]);
    stream(item.audio, local ? [] : [audioTrack]);

    item.video.hidden = !videoTrack;
    item.placeholder.hidden = Boolean(videoTrack);

    const displayName = participant.name || 'Участник';
    item.avatar.textContent = initials(displayName);
    item.sub.textContent = displayName;
    item.label.textContent = `${displayName}${local ? ' (Вы)' : ''}${screen ? ' · Демонстрация экрана' : ''}`;
    item.micBadge.textContent = screen ? '🖥' : participant.audioEnabled ? '🎙' : '🔇';
    item.micBadge.classList.toggle('muted', !screen && !participant.audioEnabled);
  }

  function render() {
    if (!meeting) return;
    const grid = $('videoGrid');
    if (!grid) return;

    const remoteList = meeting.participants.joined.toArray();
    const allParticipants = [meeting.self, ...remoteList];
    callState.participantCount = allParticipants.length;
    callState.audioEnabled = Boolean(meeting.self.audioEnabled);
    callState.videoEnabled = Boolean(meeting.self.videoEnabled);
    callState.screenShareEnabled = Boolean(meeting.self.screenShareEnabled);

    const anyScreen = allParticipants.some(p => p.screenShareEnabled);
    callState.hasScreenShare = anyScreen;

    const keep = new Set();
    let primaryAssigned = false;

    for (const p of allParticipants) {
      const local = p === meeting.self;
      const key = local ? 'self' : p.id;
      if (p.screenShareEnabled) {
        const sKey = `${key}-screen`;
        keep.add(sKey);
        tile(sKey, p, local, true, true);
        primaryAssigned = true;
      }
    }

    for (const p of allParticipants) {
      const local = p === meeting.self;
      const key = local ? 'self' : p.id;
      keep.add(key);
      const isPrimary = !primaryAssigned && callState.layout === 'speaker' && (!local || allParticipants.length === 1);
      if (isPrimary) primaryAssigned = true;
      tile(key, p, local, false, isPrimary);
    }

    for (const [key, t] of tiles) {
      if (!keep.has(key)) {
        t.video.srcObject = null;
        t.audio.srcObject = null;
        t.root.remove();
        tiles.delete(key);
      }
    }

    grid.dataset.count = String(keep.size);
    grid.dataset.mode = anyScreen ? 'screenshare' : callState.layout;
  }

  async function leave() {
    generation++;
    callState.joining = false;
    callState.connected = false;
    callState.audioEnabled = false;
    callState.videoEnabled = false;
    callState.screenShareEnabled = false;
    callState.hasScreenShare = false;
    callState.participantCount = 0;
    callState.audioBlocked = false;
    callState.statusText = '';

    const previous = meeting;
    meeting = null;
    listeners.splice(0).forEach(remove => remove());
    try { if (previous) await previous.leave(); } catch (error) { console.warn('Завершение звонка:', error); }
    for (const track of [previous?.self.audioTrack, previous?.self.videoTrack, previous?.self.screenShareTracks?.audio, previous?.self.screenShareTracks?.video]) track?.stop();
    for (const t of tiles.values()) { t.video.srcObject = null; t.audio.srcObject = null; t.root.remove(); }
    tiles.clear();
  }

  async function join(getToken) {
    if (callState.joining || meeting) return;
    if (!window.isSecureContext || !navigator.mediaDevices) throw Error('Для звонка нужен HTTPS или localhost.');
    callState.joining = true;
    const current = ++generation;
    let candidate;
    try {
      callState.statusText = 'Подключаемся к видеокомнате…';
      const SDK = await loadSdk(), token = await getToken();
      if (current !== generation) return;
      candidate = await SDK.init({ authToken: token, defaults: { audio: false, video: false } });
      if (current !== generation) { await candidate.leave(); return; }
      meeting = candidate;
      for (const event of ['audioUpdate', 'videoUpdate', 'screenShareUpdate', 'participantJoined', 'participantLeft']) listen(meeting.participants.joined, event, render);
      for (const event of ['audioUpdate', 'videoUpdate', 'screenShareUpdate']) listen(meeting.self, event, render);
      listen(meeting.self, 'roomLeft', () => { if (meeting) { showToast('Вы вышли из звонка'); void leave(); } });
      await meeting.join();
      if (current !== generation) { await candidate.leave(); return; }
      callState.connected = true;
      callState.statusText = '';
      render();
    } catch (error) {
      await leave();
      throw error;
    } finally {
      callState.joining = false;
    }
  }

  async function toggleMic() {
    if (!meeting) return;
    try {
      if (meeting.self.audioEnabled) await meeting.self.disableAudio();
      else await meeting.self.enableAudio();
      render();
    } catch (error) {
      showToast('Микрофон недоступен: ' + error.message, true);
    }
  }

  async function toggleCam() {
    if (!meeting) return;
    try {
      if (meeting.self.videoEnabled) await meeting.self.disableVideo();
      else await meeting.self.enableVideo();
      render();
    } catch (error) {
      showToast('Камера недоступна: ' + error.message, true);
    }
  }

  async function toggleScreenShare() {
    if (!meeting) return;
    try {
      if (meeting.self.screenShareEnabled) await meeting.self.disableScreenShare();
      else await meeting.self.enableScreenShare();
      render();
    } catch (error) {
      showToast('Демонстрация экрана отменена или недоступна', true);
    }
  }

  function setLayout(mode) {
    callState.layout = mode === 'speaker' ? 'speaker' : 'gallery';
    render();
  }

  function resumeAudio() {
    for (const t of tiles.values()) {
      t.audio.play().catch(() => {});
      t.video.play().catch(() => {});
    }
    callState.audioBlocked = false;
  }

  function init() {
    window.addEventListener('pagehide', () => { void leave(); });
  }

  return {
    init,
    join,
    leave,
    toggleMic,
    toggleCam,
    toggleScreenShare,
    setLayout,
    resumeAudio,
    render
  };
})();

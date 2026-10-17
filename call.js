/* Видеозвонки: SDK загружается только при присоединении к комнате. */
window.VideoCall = (() => {
  let meeting = null, sdkPromise, generation = 0, joining = false;
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
  function listen(emitter, event, handler) { emitter.on(event, handler); listeners.push(() => emitter.off(event, handler)); }
  function stream(element, tracks) {
    const usable = tracks.filter(t => t && t.readyState !== 'ended');
    const old = element.srcObject?.getTracks() || [];
    if (old.length === usable.length && old.every((t, i) => t === usable[i])) return;
    element.srcObject = usable.length ? new MediaStream(usable) : null;
    if (usable.length) element.play().catch(() => { $('callStatus').textContent = 'Нажмите «Включить звук», если браузер заблокировал воспроизведение.'; $('resumeCallAudioBtn').hidden = false; });
  }
  function tile(key, participant, local, screen) {
    let item = tiles.get(key);
    if (!item) {
      const root = document.createElement('div'); root.className = 'video-tile';
      const video = document.createElement('video'); video.autoplay = true; video.playsInline = true; video.muted = true;
      const audio = document.createElement('audio'); audio.autoplay = true;
      const placeholder = document.createElement('div'); placeholder.className = 'video-placeholder';
      const label = document.createElement('span'); label.className = 'video-tile-label';
      root.append(video, audio, placeholder, label); $('videoGrid').appendChild(root);
      item = { root, video, audio, placeholder, label }; tiles.set(key, item);
    }
    item.root.classList.toggle('mirrored', local && !screen); item.root.classList.toggle('screen-share-tile', screen);
    const video = screen ? participant.screenShareTracks?.video : participant.videoEnabled ? participant.videoTrack : null;
    const audio = screen ? participant.screenShareTracks?.audio : participant.audioEnabled ? participant.audioTrack : null;
    stream(item.video, [video]); stream(item.audio, local ? [] : [audio]);
    item.video.hidden = !video; item.placeholder.hidden = !!video;
    item.placeholder.textContent = `${participant.name || 'Участник'} · камера выключена`;
    item.label.textContent = `${participant.name || 'Участник'}${local ? ' (вы)' : ''}${screen ? ' · Экран' : participant.audioEnabled ? '' : ' · микрофон выкл.'}`;
  }
  function render() {
    if (!meeting) return;
    const keep = new Set();
    for (const p of [meeting.self, ...meeting.participants.joined.toArray()]) {
      const local = p === meeting.self, key = local ? 'self' : p.id;
      keep.add(key); tile(key, p, local, false);
      if (p.screenShareEnabled) { keep.add(key + '-screen'); tile(key + '-screen', p, local, true); }
    }
    for (const [key, t] of tiles) if (!keep.has(key)) { t.video.srcObject = null; t.audio.srcObject = null; t.root.remove(); tiles.delete(key); }
    for (const [id, enabled, on, off] of [
      ['toggleMicBtn', meeting.self.audioEnabled, 'Выключить микрофон', 'Включить микрофон'],
      ['toggleCamBtn', meeting.self.videoEnabled, 'Выключить камеру', 'Включить камеру'],
      ['shareScreenBtn', meeting.self.screenShareEnabled, 'Остановить демонстрацию', 'Показать экран']
    ]) { const button = $(id); button.classList.toggle('off', !enabled); button.title = enabled ? on : off; button.setAttribute('aria-label', button.title); button.setAttribute('aria-pressed', String(!!enabled)); }
  }
  async function leave() {
    generation++; joining = false;
    const previous = meeting; meeting = null; listeners.splice(0).forEach(remove => remove());
    try { if (previous) await previous.leave(); } catch (error) { console.warn('Завершение звонка:', error); }
    for (const track of [previous?.self.audioTrack, previous?.self.videoTrack, previous?.self.screenShareTracks?.audio, previous?.self.screenShareTracks?.video]) track?.stop();
    for (const t of tiles.values()) { t.video.srcObject = null; t.audio.srcObject = null; t.root.remove(); } tiles.clear();
    $('callVideosWrap').classList.add('hidden'); $('callControls').classList.add('hidden'); $('callJoinView').classList.remove('hidden');
    document.body.classList.remove('call-docked'); $('resumeCallAudioBtn').hidden = true; $('callStatus').textContent = '';
  }
  async function join(getToken) {
    if (joining || meeting) return;
    if (!window.isSecureContext || !navigator.mediaDevices) throw Error('Для звонка нужен HTTPS или localhost.');
    joining = true; const current = ++generation; let candidate;
    try {
      $('callStatus').textContent = 'Подключаемся к звонку…';
      const SDK = await loadSdk(), token = await getToken();
      if (current !== generation) return;
      candidate = await SDK.init({ authToken: token, defaults: { audio: false, video: false } });
      if (current !== generation) { await candidate.leave(); return; }
      meeting = candidate;
      for (const event of ['audioUpdate', 'videoUpdate', 'screenShareUpdate', 'participantJoined', 'participantLeft']) listen(meeting.participants.joined, event, render);
      for (const event of ['audioUpdate','videoUpdate','screenShareUpdate']) listen(meeting.self, event, render);
      listen(meeting.self, 'roomLeft', () => { if (meeting) { showToast('Вы вышли из звонка'); void leave(); } });
      await meeting.join();
      if (current !== generation) { await candidate.leave(); return; }
      $('callJoinView').classList.add('hidden'); $('callVideosWrap').classList.remove('hidden'); $('callControls').classList.remove('hidden');
      $('callStatus').textContent = 'Вы в комнате. Включите микрофон и камеру кнопками ниже.';
      $('shareScreenBtn').disabled = !navigator.mediaDevices.getDisplayMedia; render();
    } catch (error) { await leave(); throw error; } finally { joining = false; }
  }
  function init() {
    const controls = {
      toggleMicBtn: () => meeting.self.audioEnabled ? meeting.self.disableAudio() : meeting.self.enableAudio(),
      toggleCamBtn: () => meeting.self.videoEnabled ? meeting.self.disableVideo() : meeting.self.enableVideo(),
      // SDK сам вызывает getDisplayMedia из обработчика пользовательского клика.
      shareScreenBtn: () => meeting.self.screenShareEnabled ? meeting.self.disableScreenShare() : meeting.self.enableScreenShare()
    };
    for (const [id, action] of Object.entries(controls)) $(id).onclick = async () => {
      if (!meeting) return; $(id).disabled = true;
      try { await action(); render(); } catch (error) { showToast('Не удалось включить устройство: ' + error.message, true); } finally { $(id).disabled = false; }
    };
    $('resumeCallAudioBtn').onclick = () => { for (const t of tiles.values()) { t.audio.play().catch(() => {}); t.video.play().catch(() => {}); } $('resumeCallAudioBtn').hidden = true; };
    window.addEventListener('pagehide', () => { void leave(); });
  }
  return { init, join, leave, get active() { return !!meeting; }, get joining() { return joining; } };
})();

/* Интерактивная доска: координаты мира не зависят от размеров экрана. */
window.BoardCanvas = (() => {
  let canvas, ctx, socket, observer, reconnectTimer, frame = 0;
  let objects = [], selected = null, gesture = null, tool = 'select';
  let active = false, ready = false, pending = false, endpoint, attempt = 0;
  let width = 1, height = 1, zoom = 1, pan = { x: 0, y: 0 };
  const images = new Map();
  const $ = (id) => document.getElementById(id);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const status = (text, kind) => { $('boardWsStatus').textContent = text; $('boardWsStatus').className = `board-ws-status ${kind}`; };
  function invalidate() { if (!frame) frame = requestAnimationFrame(draw); }
  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    width = rect.width; height = rect.height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    invalidate();
  }
  function point(event) {
    const r = canvas.getBoundingClientRect();
    return { x: (event.clientX - r.left - pan.x) / zoom, y: (event.clientY - r.top - pan.y) / zoom };
  }
  function bounds(o) { return { x: o.x, y: o.y, w: Math.max(1, o.w), h: Math.max(1, o.h) }; }
  function hit(p) {
    return [...objects].reverse().find(o => { const b = bounds(o); return p.x >= b.x - 7 / zoom && p.x <= b.x + b.w + 7 / zoom && p.y >= b.y - 7 / zoom && p.y <= b.y + b.h + 7 / zoom; });
  }
  function image(url) {
    if (!images.has(url)) {
      const img = new Image(); images.set(url, img);
      img.onload = invalidate; img.onerror = invalidate; img.src = url;
    }
    return images.get(url);
  }
  function text(o) {
    ctx.fillStyle = '#243044'; ctx.font = `${o.fontSize || 24}px Inter, sans-serif`; ctx.textBaseline = 'top';
    const pad = 12, max = Math.max(10, o.w - pad * 2), lineHeight = (o.fontSize || 24) * 1.35;
    let y = o.y + pad;
    for (const paragraph of (o.text || '').split('\n')) {
      let line = '';
      for (const char of paragraph) {
        if (ctx.measureText(line + char).width > max && line) { ctx.fillText(line, o.x + pad, y); y += lineHeight; line = ''; }
        line += char;
      }
      ctx.fillText(line, o.x + pad, y); y += lineHeight;
    }
  }
  function drawObject(o) {
    ctx.save(); ctx.strokeStyle = o.color; ctx.fillStyle = o.fill || '#fff5cb'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (o.type === 'pen') {
      ctx.beginPath(); (o.points || []).forEach((p, i) => { const x = o.x + p.x * o.w, y = o.y + p.y * o.h; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke();
    } else if (o.type === 'rect') ctx.strokeRect(o.x, o.y, o.w, o.h);
    else if (o.type === 'ellipse') { ctx.beginPath(); ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, o.w / 2, o.h / 2, 0, 0, Math.PI * 2); ctx.stroke(); }
    else if (o.type === 'line' || o.type === 'arrow') {
      const x1 = o.x + (o.reverseX ? o.w : 0), x2 = o.x + (o.reverseX ? 0 : o.w);
      const y1 = o.y + (o.reverseY ? o.h : 0), y2 = o.y + (o.reverseY ? 0 : o.h);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      if (o.type === 'arrow') { const a = Math.atan2(y2 - y1, x2 - x1); ctx.moveTo(x2 - 16 * Math.cos(a - .5), y2 - 16 * Math.sin(a - .5)); ctx.lineTo(x2, y2); ctx.lineTo(x2 - 16 * Math.cos(a + .5), y2 - 16 * Math.sin(a + .5)); } ctx.stroke();
    } else if (o.type === 'image') {
      const img = image(o.url);
      if (img.complete && img.naturalWidth) ctx.drawImage(img, o.x, o.y, o.w, o.h);
      else { ctx.fillStyle = '#e6eff8'; ctx.fillRect(o.x, o.y, o.w, o.h); ctx.fillStyle = '#384862'; ctx.font = '16px sans-serif'; ctx.fillText('Изображение недоступно / загружается', o.x + 8, o.y + 25, o.w - 16); }
    } else {
      ctx.fillStyle = o.type === 'sticker' ? o.fill : '#ffffff'; ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.beginPath(); ctx.rect(o.x, o.y, o.w, o.h); ctx.clip(); text(o);
    }
    ctx.restore();
  }
  function draw() {
    frame = 0; if (!ctx || !active) return;
    const dpr = window.devicePixelRatio || 1; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#cdd5df';
    const step = 24 * zoom;
    for (let x = ((pan.x % step) + step) % step; x < width; x += step) for (let y = ((pan.y % step) + step) % step; y < height; y += step) ctx.fillRect(x, y, 1, 1);
    ctx.translate(pan.x, pan.y); ctx.scale(zoom, zoom);
    objects.forEach(drawObject);
    if (gesture?.draft && !gesture.original) drawObject(gesture.draft);
    const o = objects.find(item => item.id === selected);
    if (o) {
      ctx.strokeStyle = '#537eae'; ctx.lineWidth = 2 / zoom; ctx.setLineDash([6 / zoom, 4 / zoom]); ctx.strokeRect(o.x - 3, o.y - 3, o.w + 6, o.h + 6); ctx.setLineDash([]);
      ctx.fillStyle = '#537eae'; ctx.fillRect(o.x + o.w - 7 / zoom, o.y + o.h - 7 / zoom, 14 / zoom, 14 / zoom);
    }
    $('bringToFrontBtn').disabled = $('sendToBackBtn').disabled = !o || !ready || pending;
    $('boardZoomValue').textContent = `${Math.round(zoom * 100)}%`;
  }
  function send(message) {
    if (!ready || pending || socket?.readyState !== WebSocket.OPEN) { showToast('Дождитесь подключения и сохранения доски.', true); return false; }
    pending = true; status('Сохранение…', 'connecting'); socket.send(JSON.stringify(message)); invalidate(); return true;
  }
  function connect() {
    if (!active) return; ready = false; pending = false; status('Подключение…', 'connecting');
    const ws = new WebSocket(endpoint); socket = ws;
    ws.onmessage = event => {
      if (socket !== ws) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'error') { pending = false; showToast(msg.error, true); return; }
        if (msg.type === 'state') { objects = msg.state.objects; gesture = null; ready = true; pending = false; attempt = 0; status('Сохранено · Онлайн', 'connected'); invalidate(); }
      } catch { status('Ошибка данных', 'error'); }
    };
    ws.onclose = event => {
      if (socket !== ws || !active) return; ready = false; pending = false; gesture = null;
      if (event.code === 4004) { status('Доска удалена', 'error'); return; }
      status('Связь потеряна · переподключение…', 'error');
      reconnectTimer = setTimeout(connect, Math.min(15000, 1000 * 2 ** attempt++));
    };
    ws.onerror = () => status('Ошибка соединения', 'error');
  }
  function down(e) {
    if (!active || e.button > 0) return; canvas.setPointerCapture(e.pointerId); const p = point(e);
    if (tool === 'pan' || e.altKey) { gesture = { panStart: { ...pan }, clientX: e.clientX, clientY: e.clientY }; return; }
    if (!ready || pending) return;
    const found = hit(p);
    if (tool === 'select') {
      const previous = objects.find(o => o.id === selected);
      const handle = previous && Math.abs(p.x - previous.x - previous.w) < 18 / zoom && Math.abs(p.y - previous.y - previous.h) < 18 / zoom;
      const target = handle ? previous : found; selected = target?.id || null;
      if (target) gesture = { start: p, original: clone(target), resize: handle };
    } else if (tool === 'eraser') { if (found) send({ type: 'delete', objectId: found.id }); }
    else if (['text', 'sticker', 'image'].includes(tool)) {
      const value = prompt(tool === 'image' ? 'Прямая ссылка на изображение (https://)' : 'Текст (двойной клик по объекту — изменить):');
      if (!value?.trim()) return;
      const o = { id: crypto.randomUUID(), type: tool, x: p.x, y: p.y, w: 240, h: 160, color: $('boardColorInput').value, fill: $('boardStickerColorInput').value, text: value.trim() };
      if (tool === 'image') {
        try { if (!['https:', 'http:'].includes(new URL(value).protocol)) throw Error(); } catch { showToast('Укажите корректный HTTP(S) URL.', true); return; }
        o.url = value.trim(); delete o.text;
      }
      send({ type: 'add', object: o }); selected = o.id;
    } else {
      gesture = { start: p, rawPoints: [p], draft: { id: crypto.randomUUID(), type: tool, x: p.x, y: p.y, w: 1, h: 1, color: $('boardColorInput').value } };
    }
    invalidate();
  }
  function move(e) {
    if (!gesture) return;
    if (gesture.panStart) { pan = { x: gesture.panStart.x + e.clientX - gesture.clientX, y: gesture.panStart.y + e.clientY - gesture.clientY }; invalidate(); return; }
    const p = point(e), g = gesture;
    if (g.original) {
      const o = objects.find(item => item.id === selected); if (!o) return;
      if (g.resize) { o.w = Math.max(24, g.original.w + p.x - g.start.x); o.h = Math.max(24, g.original.h + p.y - g.start.y); }
      else { o.x = g.original.x + p.x - g.start.x; o.y = g.original.y + p.y - g.start.y; }
    } else if (g.draft) {
      const o = g.draft;
      if (tool === 'pen') {
        if (g.rawPoints.length >= 2000) return; g.rawPoints.push(p);
        o.x = Math.min(...g.rawPoints.map(v => v.x)); o.y = Math.min(...g.rawPoints.map(v => v.y));
        o.w = Math.max(1, ...g.rawPoints.map(v => v.x - o.x)); o.h = Math.max(1, ...g.rawPoints.map(v => v.y - o.y));
        o.points = g.rawPoints.map(v => ({ x: (v.x - o.x) / o.w, y: (v.y - o.y) / o.h }));
      } else { o.x = Math.min(p.x, g.start.x); o.y = Math.min(p.y, g.start.y); o.w = Math.max(1, Math.abs(p.x - g.start.x)); o.h = Math.max(1, Math.abs(p.y - g.start.y)); o.reverseX = p.x < g.start.x; o.reverseY = p.y < g.start.y; }
    }
    invalidate();
  }
  function up(e) {
    const g = gesture; if (!g) return; move(e); gesture = null;
    if (g.original) { const o = objects.find(v => v.id === selected); if (o) send({ type: 'update', object: clone(o) }); }
    else if (g.draft && (g.draft.type !== 'pen' || g.draft.points?.length)) { selected = g.draft.id; send({ type: 'add', object: g.draft }); }
    invalidate();
  }
  function choose(value) { tool = value; document.querySelectorAll('[data-tool]').forEach(btn => btn.classList.toggle('active', btn.dataset.tool === tool)); canvas.style.cursor = tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair'; }
  function fit() {
    if (!objects.length) { zoom = 1; pan = { x: 0, y: 0 }; invalidate(); return; }
    const x = Math.min(...objects.map(o => o.x)), y = Math.min(...objects.map(o => o.y));
    const w = Math.max(...objects.map(o => o.x + o.w)) - x, h = Math.max(...objects.map(o => o.y + o.h)) - y;
    zoom = Math.max(.1, Math.min(2, (width - 60) / Math.max(1, w), (height - 60) / Math.max(1, h)));
    pan = { x: (width - w * zoom) / 2 - x * zoom, y: (height - h * zoom) / 2 - y * zoom }; invalidate();
  }
  function init() {
    canvas = $('boardCanvas'); ctx = canvas.getContext('2d');
    observer = new ResizeObserver(resize); observer.observe(canvas.parentElement);
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', () => { if (gesture?.original) { const i = objects.findIndex(o => o.id === selected); if (i >= 0) objects[i] = gesture.original; } gesture = null; invalidate(); });
    canvas.addEventListener('dblclick', e => { const o = hit(point(e)); if (!o || !['sticker', 'text'].includes(o.type) || !ready || pending) return; const value = prompt('Изменить текст:', o.text); if (value?.trim()) send({ type: 'update', object: { ...o, text: value.trim() } }); });
    canvas.addEventListener('wheel', e => { e.preventDefault(); const p = point(e); zoom = Math.max(.1, Math.min(4, zoom * (e.deltaY > 0 ? .9 : 1.1))); const r = canvas.getBoundingClientRect(); pan = { x: e.clientX - r.left - p.x * zoom, y: e.clientY - r.top - p.y * zoom }; invalidate(); }, { passive: false });
    document.querySelectorAll('[data-tool]').forEach(btn => { btn.setAttribute('aria-label', btn.title); btn.onclick = () => choose(btn.dataset.tool); });
    $('boardFitBtn').onclick = fit; $('boardZoomOutBtn').onclick = () => { zoom = Math.max(.1, zoom / 1.2); invalidate(); }; $('boardZoomInBtn').onclick = () => { zoom = Math.min(4, zoom * 1.2); invalidate(); };
    $('clearBoardBtn').onclick = () => { if (confirm('Очистить всю доску для всех участников?')) send({ type: 'clear' }); };
    $('bringToFrontBtn').onclick = () => send({ type: 'reorder', objectId: selected, newIndex: objects.length - 1 });
    $('sendToBackBtn').onclick = () => send({ type: 'reorder', objectId: selected, newIndex: 0 });
    document.addEventListener('keydown', e => {
      if (!active || document.querySelector('.modal-overlay:not(.hidden)') || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === 'Delete' && selected) { e.preventDefault(); send({ type: 'delete', objectId: selected }); }
      const keys = { v: 'select', p: 'pen', r: 'rect', o: 'ellipse', a: 'arrow', l: 'line', s: 'sticker', t: 'text', i: 'image', e: 'eraser', h: 'pan' };
      if (!e.ctrlKey && !e.metaKey && keys[e.key.toLowerCase()]) choose(keys[e.key.toLowerCase()]);
    });
  }
  function close() { active = false; ready = false; clearTimeout(reconnectTimer); if (socket) { socket.onclose = null; socket.close(); socket = null; } if (frame) cancelAnimationFrame(frame); frame = 0; gesture = null; images.clear(); }
  function open(url) { close(); endpoint = url; objects = []; selected = null; active = true; attempt = 0; zoom = 1; pan = { x: 0, y: 0 }; resize(); connect(); }
  return { init, open, close, fit };
})();

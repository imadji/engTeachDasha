/* Интерактивная доска в стиле Miro:
   - Бесконечный холст на весь экран без прокрутки страницы;
   - Колёсико мыши = панорама (или горизонтальная с Shift), Ctrl/Cmd + колёсико = масштабирование;
   - Поддержка Фреймов (frame): перемещаются вместе со всеми вложенными объектами, переименовываются, есть быстрый переход;
   - Вставка картинок: с компьютера (автосжатие в JPEG/PNG), через Ctrl+V из буфера обмена, Drag&Drop файла на холст или по прямой ссылке. */
import { reactive } from 'vue';
import { useAppStore } from '../stores/appStore';

const showToast = (message, error) => useAppStore().toast(message, error);

export const boardUi = reactive({
  tool: 'select',
  zoomPercent: 100,
  wsStatusText: 'Подключение…',
  wsStatusKind: 'connecting',
  hasSelection: false,
  selectedType: null,
  frames: [],
  imageModalOpen: false,
  pendingInsertPoint: null,
  // Модальное окно ввода текста (замена браузерному prompt())
  textModalOpen: false,
  textModal: { title: 'Введите текст', value: '', multiline: true, placeholder: '', submitLabel: 'Сохранить' },
  // Модальное окно подтверждения (замена браузерному confirm())
  confirmModalOpen: false,
  confirmModal: { title: 'Подтвердите действие', message: '', confirmLabel: 'Подтвердить' }
});

let textModalResolve = null;
let confirmModalResolve = null;

/**
 * Открыть красивое модальное окно ввода текста вместо системного prompt().
 * Возвращает Promise<string|null> — введённый текст или null при отмене.
 */
export function requestBoardText({ title = 'Введите текст', value = '', multiline = true, placeholder = '', submitLabel = 'Сохранить' } = {}) {
  boardUi.textModal.title = title;
  boardUi.textModal.value = value;
  boardUi.textModal.multiline = multiline;
  boardUi.textModal.placeholder = placeholder;
  boardUi.textModal.submitLabel = submitLabel;
  boardUi.textModalOpen = true;

  return new Promise(resolve => {
    textModalResolve = resolve;
  });
}

/**
 * Вызывается из TextEditModal при подтверждении ввода.
 */
export function resolveBoardText(value) {
  boardUi.textModalOpen = false;
  if (textModalResolve) {
    textModalResolve(value);
    textModalResolve = null;
  }
}

/**
 * Открыть модальное окно подтверждения вместо системного confirm().
 * Возвращает Promise<boolean>.
 */
export function requestBoardConfirm({ title = 'Подтвердите действие', message = '', confirmLabel = 'Подтвердить' } = {}) {
  boardUi.confirmModal.title = title;
  boardUi.confirmModal.message = message;
  boardUi.confirmModal.confirmLabel = confirmLabel;
  boardUi.confirmModalOpen = true;

  return new Promise(resolve => {
    confirmModalResolve = resolve;
  });
}

/**
 * Вызывается из ConfirmModal: true — действие подтверждено, false — отменено.
 */
export function resolveBoardConfirm(value) {
  boardUi.confirmModalOpen = false;
  if (confirmModalResolve) {
    confirmModalResolve(Boolean(value));
    confirmModalResolve = null;
  }
}

/**
 * Сжатие загруженного файла или картинки из буфера обмена в компактный dataURL (до ~1280px, JPEG/PNG < 320 КБ),
 * чтобы картинка мгновенно синхронизировалась через WebSocket и сохранялась в Cloudflare Durable Object.
 */
export async function compressImageFileToDataUrl(file) {
  if (!file || !file.type?.startsWith('image/')) {
    throw new Error('Выберите графический файл (PNG, JPG, WebP, GIF)');
  }
  const bitmapUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Не удалось прочитать изображение'));
      el.src = bitmapUrl;
    });

    const maxSide = 1280;
    let w = img.naturalWidth || 600;
    let h = img.naturalHeight || 450;
    if (w > maxSide || h > maxSide) {
      const ratio = Math.min(maxSide / w, maxSide / h);
      w = Math.max(1, Math.round(w * ratio));
      h = Math.max(1, Math.round(h * ratio));
    }

    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const octx = offscreen.getContext('2d');
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, w, h);
    octx.drawImage(img, 0, 0, w, h);

    let quality = 0.82;
    let dataUrl = offscreen.toDataURL('image/jpeg', quality);
    while (dataUrl.length > 430000 && quality > 0.4) {
      quality -= 0.12;
      dataUrl = offscreen.toDataURL('image/jpeg', quality);
    }
    if (dataUrl.length > 470000) {
      throw new Error('Изображение слишком тяжёлое даже после сжатия. Выберите картинку поменьше.');
    }
    return { dataUrl, width: w, height: h };
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}

export const BoardCanvas = (() => {
  let canvas, ctx, socket, observer, reconnectTimer, frame = 0;
  let objects = [], selected = null, gesture = null, tool = 'select';
  let active = false, ready = false, pending = false, endpoint, attempt = 0, pendingId = null;
  let width = 1, height = 1, zoom = 1, pan = { x: 0, y: 0 };
  const images = new Map();
  const $ = id => document.getElementById(id);
  const clone = value => JSON.parse(JSON.stringify(value));

  function status(text, kind) {
    boardUi.wsStatusText = text;
    boardUi.wsStatusKind = kind;
  }

  function syncFramesList() {
    boardUi.frames = objects
      .filter(o => o.type === 'frame')
      .map((f, idx) => ({ id: f.id, title: f.title || `Фрейм ${idx + 1}`, x: f.x, y: f.y, w: f.w, h: f.h }));
    const sel = objects.find(o => o.id === selected);
    boardUi.hasSelection = Boolean(sel && ready && !pending);
    boardUi.selectedType = sel?.type || null;
    boardUi.zoomPercent = Math.round(zoom * 100);
  }

  function invalidate() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  function resize() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    width = rect.width;
    height = rect.height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    invalidate();
  }

  function point(event) {
    const r = canvas.getBoundingClientRect();
    return { x: (event.clientX - r.left - pan.x) / zoom, y: (event.clientY - r.top - pan.y) / zoom };
  }

  function viewportCenter() {
    return { x: (width / 2 - pan.x) / zoom, y: (height / 2 - pan.y) / zoom };
  }

  function bounds(o) {
    return { x: o.x, y: o.y, w: Math.max(1, o.w), h: Math.max(1, o.h) };
  }

  // Сначала ищем обычные объекты сверху вниз, а фреймы проверяем по заголовку/рамке или в самом конце,
  // чтобы объекты внутри фрейма легко выделялись кликом.
  function hit(p) {
    const nonFrames = objects.filter(o => o.type !== 'frame').reverse();
    const hitNonFrame = nonFrames.find(o => {
      const b = bounds(o);
      return p.x >= b.x - 7 / zoom && p.x <= b.x + b.w + 7 / zoom && p.y >= b.y - 7 / zoom && p.y <= b.y + b.h + 7 / zoom;
    });
    if (hitNonFrame) return hitNonFrame;

    const frames = objects.filter(o => o.type === 'frame').reverse();
    return frames.find(o => {
      const b = bounds(o);
      return p.x >= b.x - 7 / zoom && p.x <= b.x + b.w + 7 / zoom && p.y >= b.y - 32 / zoom && p.y <= b.y + b.h + 7 / zoom;
    });
  }

  function isInsideFrame(child, frameObj) {
    if (child.id === frameObj.id || child.type === 'frame') return false;
    const cx = child.x + child.w / 2;
    const cy = child.y + child.h / 2;
    return cx >= frameObj.x && cx <= frameObj.x + frameObj.w && cy >= frameObj.y && cy <= frameObj.y + frameObj.h;
  }

  function image(url) {
    if (!images.has(url)) {
      const img = new Image();
      images.set(url, img);
      img.onload = invalidate;
      img.onerror = invalidate;
      img.src = url;
    }
    return images.get(url);
  }

  function drawMultilineText(o, color = '#243044', pad = 12) {
    ctx.fillStyle = color;
    ctx.font = `${o.fontSize || 22}px Inter, sans-serif`;
    ctx.textBaseline = 'top';
    const max = Math.max(10, o.w - pad * 2);
    const lineHeight = (o.fontSize || 22) * 1.35;
    let y = o.y + pad;
    for (const paragraph of (o.text || '').split('\n')) {
      let line = '';
      for (const char of paragraph) {
        if (ctx.measureText(line + char).width > max && line) {
          ctx.fillText(line, o.x + pad, y);
          y += lineHeight;
          line = '';
        }
        line += char;
      }
      ctx.fillText(line, o.x + pad, y);
      y += lineHeight;
    }
  }

  function drawObject(o) {
    ctx.save();
    ctx.strokeStyle = o.color || '#7c9cbf';
    ctx.fillStyle = o.fill || '#fdf6e7';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (o.type === 'frame') {
      // Miro-фрейм: светлая подложка, аккуратная рамка и подпись сверху слева
      ctx.fillStyle = o.fill || '#ffffff';
      ctx.strokeStyle = o.color || '#94a8be';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(o.x, o.y, o.w, o.h, 12) : ctx.rect(o.x, o.y, o.w, o.h);
      ctx.fill();
      ctx.stroke();

      // Плашка названия фрейма сверху
      const titleText = o.title || 'Фрейм';
      ctx.font = '700 15px Nunito, Inter, sans-serif';
      ctx.fillStyle = '#475569';
      ctx.textBaseline = 'bottom';
      ctx.fillText(titleText, o.x + 4, o.y - 6);
    } else if (o.type === 'pen') {
      ctx.beginPath();
      (o.points || []).forEach((p, i) => {
        const x = o.x + p.x * o.w;
        const y = o.y + p.y * o.h;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.stroke();
    } else if (o.type === 'rect') {
      ctx.strokeRect(o.x, o.y, o.w, o.h);
    } else if (o.type === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, o.w / 2, o.h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (o.type === 'line' || o.type === 'arrow') {
      const x1 = o.x + (o.reverseX ? o.w : 0);
      const x2 = o.x + (o.reverseX ? 0 : o.w);
      const y1 = o.y + (o.reverseY ? o.h : 0);
      const y2 = o.y + (o.reverseY ? 0 : o.h);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      if (o.type === 'arrow') {
        const a = Math.atan2(y2 - y1, x2 - x1);
        ctx.moveTo(x2 - 16 * Math.cos(a - 0.5), y2 - 16 * Math.sin(a - 0.5));
        ctx.lineTo(x2, y2);
        ctx.lineTo(x2 - 16 * Math.cos(a + 0.5), y2 - 16 * Math.sin(a + 0.5));
      }
      ctx.stroke();
    } else if (o.type === 'image') {
      const img = image(o.url);
      if (img.complete && img.naturalWidth) {
        ctx.drawImage(img, o.x, o.y, o.w, o.h);
      } else {
        ctx.fillStyle = '#e6eff8';
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.fillStyle = '#384862';
        ctx.font = '15px Inter, sans-serif';
        ctx.fillText('Загрузка изображения…', o.x + 12, o.y + 28, Math.max(20, o.w - 24));
      }
    } else if (o.type === 'sticker') {
      ctx.shadowColor = 'rgba(0,0,0,0.08)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = o.fill || '#fdf6e7';
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.shadowColor = 'transparent';
      ctx.beginPath();
      ctx.rect(o.x, o.y, o.w, o.h);
      ctx.clip();
      drawMultilineText(o, '#243044', 14);
    } else {
      // Текстовый блок
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.strokeStyle = '#dbe3ec';
      ctx.lineWidth = 1;
      ctx.strokeRect(o.x, o.y, o.w, o.h);
      ctx.beginPath();
      ctx.rect(o.x, o.y, o.w, o.h);
      ctx.clip();
      drawMultilineText(o, o.color || '#243044', 10);
    }
    ctx.restore();
  }

  function draw() {
    frame = 0;
    if (!ctx || !active) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Точечная сетка Miro
    ctx.fillStyle = '#cbd5e1';
    const step = Math.max(14, 24 * zoom);
    for (let x = ((pan.x % step) + step) % step; x < width; x += step) {
      for (let y = ((pan.y % step) + step) % step; y < height; y += step) {
        ctx.fillRect(x, y, 1.5, 1.5);
      }
    }

    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Сначала рисуем все фреймы (на заднем плане), затем остальные объекты
    for (const o of objects) if (o.type === 'frame') drawObject(o);
    for (const o of objects) if (o.type !== 'frame') drawObject(o);

    if (gesture?.draft && !gesture.original) drawObject(gesture.draft);

    const o = objects.find(item => item.id === selected);
    if (o) {
      ctx.strokeStyle = '#4f81bd';
      ctx.lineWidth = 2 / zoom;
      ctx.setLineDash([6 / zoom, 4 / zoom]);
      ctx.strokeRect(o.x - 3, o.y - 3, o.w + 6, o.h + 6);
      ctx.setLineDash([]);
      ctx.fillStyle = '#4f81bd';
      ctx.fillRect(o.x + o.w - 7 / zoom, o.y + o.h - 7 / zoom, 14 / zoom, 14 / zoom);
    }

    syncFramesList();
  }

  function send(message) {
    if (!ready || pending || socket?.readyState !== WebSocket.OPEN) {
      showToast('Дождитесь подключения к доске.', true);
      return false;
    }
    pending = true;
    pendingId = crypto.randomUUID();
    status('Сохранение…', 'connecting');
    socket.send(JSON.stringify({ ...message, opId: pendingId }));
    invalidate();
    return true;
  }

  function connect() {
    if (!active) return;
    ready = false;
    pending = false;
    status('Подключение…', 'connecting');
    const ws = new WebSocket(endpoint);
    socket = ws;
    ws.onmessage = event => {
      if (socket !== ws) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'error') {
          pending = false;
          if (msg.state) objects = msg.state.objects;
          status('Отклонено', 'error');
          showToast(msg.error, true);
          invalidate();
          return;
        }
        if (msg.type === 'state') {
          objects = msg.state.objects || [];
          gesture = null;
          ready = true;
          if (!msg.ack || msg.ack === pendingId) pending = false;
          attempt = 0;
          status(pending ? 'Сохранение…' : 'Онлайн', 'connected');
          invalidate();
        }
      } catch {
        status('Ошибка данных', 'error');
      }
    };
    ws.onclose = event => {
      if (socket !== ws || !active) return;
      ready = false;
      pending = false;
      gesture = null;
      if (event.code === 4004) {
        status('Доска удалена', 'error');
        return;
      }
      status('Переподключение…', 'error');
      if (attempt >= 5) {
        status('Нет связи', 'error');
        return;
      }
      reconnectTimer = setTimeout(connect, Math.min(15000, 1000 * 2 ** attempt++));
    };
    ws.onerror = () => status('Ошибка сети', 'error');
  }

  function addImageObject(url, naturalW = 360, naturalH = 260, customPoint = null) {
    if (!ready || pending) {
      showToast('Доска ещё подключается, попробуйте через секунду', true);
      return false;
    }
    const center = customPoint || boardUi.pendingInsertPoint || viewportCenter();
    boardUi.pendingInsertPoint = null;
    const maxSide = 360;
    const ratio = Math.min(1, maxSide / Math.max(1, naturalW), maxSide / Math.max(1, naturalH));
    const w = Math.max(80, Math.round(naturalW * ratio));
    const h = Math.max(60, Math.round(naturalH * ratio));
    const o = {
      id: crypto.randomUUID(),
      type: 'image',
      x: Math.round(center.x - w / 2),
      y: Math.round(center.y - h / 2),
      w,
      h,
      url
    };
    if (send({ type: 'add', object: o })) {
      selected = o.id;
      choose('select');
      return true;
    }
    return false;
  }

  function addPresetFrame(title = '', widthFrame = 800, heightFrame = 520) {
    if (!ready || pending) return;
    const c = viewportCenter();
    const frameIndex = objects.filter(o => o.type === 'frame').length + 1;
    const o = {
      id: crypto.randomUUID(),
      type: 'frame',
      title: title || `Фрейм ${frameIndex}`,
      x: Math.round(c.x - widthFrame / 2),
      y: Math.round(c.y - heightFrame / 2),
      w: widthFrame,
      h: heightFrame,
      color: '#94a8be',
      fill: '#ffffff'
    };
    if (send({ type: 'add', object: o })) {
      selected = o.id;
      choose('select');
    }
  }

  function focusFrame(frameId) {
    const f = objects.find(o => o.id === frameId && o.type === 'frame');
    if (!f) return;
    selected = f.id;
    zoom = Math.max(0.15, Math.min(1.6, (width - 120) / Math.max(1, f.w), (height - 120) / Math.max(1, f.h)));
    pan = {
      x: (width - f.w * zoom) / 2 - f.x * zoom,
      y: (height - f.h * zoom) / 2 - f.y * zoom
    };
    invalidate();
  }

  async function down(e) {
    if (!active || e.button > 1) return;
    canvas.setPointerCapture(e.pointerId);
    const p = point(e);

    // Средняя кнопка мыши, Пробел/Alt или инструмент «Рука» — панорамирование
    if (tool === 'pan' || e.altKey || e.button === 1) {
      gesture = { panStart: { ...pan }, clientX: e.clientX, clientY: e.clientY };
      return;
    }
    if (!ready || pending) return;

    const found = hit(p);
    if (tool === 'select') {
      const previous = objects.find(o => o.id === selected);
      const handle =
        previous &&
        Math.abs(p.x - previous.x - previous.w) < 18 / zoom &&
        Math.abs(p.y - previous.y - previous.h) < 18 / zoom;
      const target = handle ? previous : found;
      selected = target?.id || null;
      if (target) {
        // Если перемещаем фрейм (не меняя размер), захватываем все вложенные объекты
        const children =
          target.type === 'frame' && !handle
            ? objects.filter(ch => isInsideFrame(ch, target)).map(ch => clone(ch))
            : [];
        gesture = { start: p, original: clone(target), resize: handle, children };
      }
    } else if (tool === 'eraser') {
      if (found) send({ type: 'delete', objectId: found.id });
    } else if (tool === 'image') {
      boardUi.pendingInsertPoint = p;
      boardUi.imageModalOpen = true;
    } else if (tool === 'frame') {
      const frameIndex = objects.filter(o => o.type === 'frame').length + 1;
      gesture = {
        start: p,
        draft: {
          id: crypto.randomUUID(),
          type: 'frame',
          title: `Фрейм ${frameIndex}`,
          x: p.x,
          y: p.y,
          w: 480,
          h: 320,
          color: '#94a8be',
          fill: '#ffffff'
        }
      };
    } else if (['text', 'sticker'].includes(tool)) {
      const isSticker = tool === 'sticker';
      const value = await requestBoardText({
        title: isSticker ? 'Новый стикер' : 'Новый текстовый блок',
        placeholder: isSticker ? 'Например: Could you repeat, please?' : 'Текст заметки на доске…',
        submitLabel: 'Добавить на доску'
      });
      if (!value?.trim()) return;
      const o = {
        id: crypto.randomUUID(),
        type: tool,
        x: Math.round(p.x),
        y: Math.round(p.y),
        w: isSticker ? 220 : 260,
        h: isSticker ? 180 : 110,
        color: $('boardColorInput')?.value || '#243044',
        fill: $('boardStickerColorInput')?.value || '#fdf6e7',
        text: value.trim()
      };
      send({ type: 'add', object: o });
      selected = o.id;
      choose('select');
    } else {
      gesture = {
        start: p,
        rawPoints: [p],
        draft: {
          id: crypto.randomUUID(),
          type: tool,
          x: p.x,
          y: p.y,
          w: 1,
          h: 1,
          color: $('boardColorInput')?.value || '#7c9cbf'
        }
      };
    }
    invalidate();
  }

  function move(e) {
    if (!gesture) return;
    if (gesture.panStart) {
      pan = {
        x: gesture.panStart.x + e.clientX - gesture.clientX,
        y: gesture.panStart.y + e.clientY - gesture.clientY
      };
      invalidate();
      return;
    }
    const p = point(e);
    const g = gesture;
    if (g.original) {
      const o = objects.find(item => item.id === selected);
      if (!o) return;
      const dx = p.x - g.start.x;
      const dy = p.y - g.start.y;
      if (g.resize) {
        o.w = Math.max(40, Math.round(g.original.w + dx));
        o.h = Math.max(40, Math.round(g.original.h + dy));
      } else {
        o.x = Math.round(g.original.x + dx);
        o.y = Math.round(g.original.y + dy);
        if (g.children?.length) {
          for (const origChild of g.children) {
            const liveChild = objects.find(item => item.id === origChild.id);
            if (liveChild) {
              liveChild.x = Math.round(origChild.x + dx);
              liveChild.y = Math.round(origChild.y + dy);
            }
          }
        }
      }
    } else if (g.draft) {
      const o = g.draft;
      if (tool === 'pen') {
        if (g.rawPoints.length >= 2000) return;
        g.rawPoints.push(p);
        o.x = Math.min(...g.rawPoints.map(v => v.x));
        o.y = Math.min(...g.rawPoints.map(v => v.y));
        o.w = Math.max(1, ...g.rawPoints.map(v => v.x - o.x));
        o.h = Math.max(1, ...g.rawPoints.map(v => v.y - o.y));
        o.points = g.rawPoints.map(v => ({ x: (v.x - o.x) / o.w, y: (v.y - o.y) / o.h }));
      } else {
        o.x = Math.round(Math.min(p.x, g.start.x));
        o.y = Math.round(Math.min(p.y, g.start.y));
        const minW = o.type === 'frame' ? 260 : 4;
        const minH = o.type === 'frame' ? 180 : 4;
        o.w = Math.max(minW, Math.round(Math.abs(p.x - g.start.x)));
        o.h = Math.max(minH, Math.round(Math.abs(p.y - g.start.y)));
        o.reverseX = p.x < g.start.x;
        o.reverseY = p.y < g.start.y;
      }
    }
    invalidate();
  }

  function up(e) {
    const g = gesture;
    if (!g) return;
    move(e);
    gesture = null;
    if (g.original) {
      const o = objects.find(v => v.id === selected);
      if (o) {
        if (g.children?.length) {
          const updatedList = [
            clone(o),
            ...g.children
              .map(ch => objects.find(v => v.id === ch.id))
              .filter(Boolean)
              .map(clone)
          ];
          send({ type: 'batch', objects: updatedList });
        } else {
          send({ type: 'update', object: clone(o) });
        }
      }
    } else if (g.draft && (g.draft.type !== 'pen' || g.draft.points?.length)) {
      selected = g.draft.id;
      send({ type: 'add', object: g.draft });
      if (g.draft.type === 'frame') choose('select');
    }
    invalidate();
  }

  function choose(value) {
    tool = value;
    boardUi.tool = value;
    if (!canvas) return;
    canvas.style.cursor = tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
  }

  function fit() {
    if (!objects.length) {
      zoom = 1;
      pan = { x: 0, y: 0 };
      invalidate();
      return;
    }
    const x = Math.min(...objects.map(o => o.x));
    const y = Math.min(...objects.map(o => o.y));
    const w = Math.max(...objects.map(o => o.x + o.w)) - x;
    const h = Math.max(...objects.map(o => o.y + o.h)) - y;
    zoom = Math.max(0.1, Math.min(2, (width - 80) / Math.max(1, w), (height - 80) / Math.max(1, h)));
    pan = { x: (width - w * zoom) / 2 - x * zoom, y: (height - h * zoom) / 2 - y * zoom };
    invalidate();
  }

  function zoomBy(factor) {
    const c = viewportCenter();
    zoom = Math.max(0.1, Math.min(4, zoom * factor));
    pan = { x: width / 2 - c.x * zoom, y: height / 2 - c.y * zoom };
    invalidate();
  }

  function bringToFront() {
    if (selected) send({ type: 'reorder', objectId: selected, newIndex: objects.length - 1 });
  }

  function sendToBack() {
    if (selected) send({ type: 'reorder', objectId: selected, newIndex: 0 });
  }

  function deleteSelected() {
    if (selected) {
      send({ type: 'delete', objectId: selected });
      selected = null;
    }
  }

  async function clearBoard() {
    const confirmed = await requestBoardConfirm({
      title: 'Очистить всю доску?',
      message: 'Все рисунки, стикеры, фреймы и картинки будут удалены для всех участников. Действие нельзя отменить.',
      confirmLabel: 'Очистить доску'
    });
    if (!confirmed) return;
    send({ type: 'clear' });
    selected = null;
  }

  async function onPaste(e) {
    if (!active || /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type?.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        try {
          showToast('Обрабатываем изображение из буфера…');
          const { dataUrl, width: w, height: h } = await compressImageFileToDataUrl(file);
          addImageObject(dataUrl, w, h);
        } catch (err) {
          showToast(err.message, true);
        }
        return;
      }
    }
  }

  async function onDrop(e) {
    if (!active) return;
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file || !file.type?.startsWith('image/')) return;
    const dropPoint = point(e);
    try {
      showToast('Загружаем картинку на доску…');
      const { dataUrl, width: w, height: h } = await compressImageFileToDataUrl(file);
      addImageObject(dataUrl, w, h, dropPoint);
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function onKeydown(e) {
    if (!active || document.querySelector('.modal-overlay') || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault();
      deleteSelected();
      return;
    }
    const keys = {
      v: 'select',
      h: 'pan',
      f: 'frame',
      p: 'pen',
      r: 'rect',
      o: 'ellipse',
      a: 'arrow',
      l: 'line',
      s: 'sticker',
      t: 'text',
      i: 'image',
      e: 'eraser'
    };
    if (!e.ctrlKey && !e.metaKey && keys[e.key.toLowerCase()]) {
      if (keys[e.key.toLowerCase()] === 'image') {
        boardUi.pendingInsertPoint = viewportCenter();
        boardUi.imageModalOpen = true;
      } else {
        choose(keys[e.key.toLowerCase()]);
      }
    }
  }

  function init() {
    canvas = $('boardCanvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    observer = new ResizeObserver(resize);
    observer.observe(canvas.parentElement);

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', () => {
      if (gesture?.original) {
        const i = objects.findIndex(o => o.id === selected);
        if (i >= 0) objects[i] = gesture.original;
      }
      gesture = null;
      invalidate();
    });

    canvas.addEventListener('dblclick', async e => {
      const o = hit(point(e));
      if (!o || !ready || pending) return;
      if (o.type === 'frame') {
        const value = await requestBoardText({
          title: 'Переименовать фрейм',
          value: o.title || 'Фрейм',
          multiline: false,
          placeholder: 'Например: Слайд 1 — Введение',
          submitLabel: 'Переименовать'
        });
        if (value?.trim()) send({ type: 'update', object: { ...o, title: value.trim() } });
      } else if (['sticker', 'text'].includes(o.type)) {
        const value = await requestBoardText({
          title: o.type === 'sticker' ? 'Изменить стикер' : 'Изменить текстовый блок',
          value: o.text || '',
          submitLabel: 'Сохранить'
        });
        if (value?.trim()) send({ type: 'update', object: { ...o, text: value.trim() } });
      }
    });

    // Как в Miro: обычное колёсико панорамирует холст (не страницу!), Ctrl/Cmd + колёсико масштабирует
    canvas.addEventListener(
      'wheel',
      e => {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          const p = point(e);
          zoom = Math.max(0.1, Math.min(4, zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
          const r = canvas.getBoundingClientRect();
          pan = { x: e.clientX - r.left - p.x * zoom, y: e.clientY - r.top - p.y * zoom };
        } else {
          pan = {
            x: pan.x - (e.shiftKey ? e.deltaY : e.deltaX),
            y: pan.y - (e.shiftKey ? 0 : e.deltaY)
          };
        }
        invalidate();
      },
      { passive: false }
    );

    canvas.addEventListener('dragover', e => e.preventDefault());
    canvas.addEventListener('drop', onDrop);

    window.addEventListener('paste', onPaste);
    document.addEventListener('keydown', onKeydown);
  }

  function close() {
    active = false;
    ready = false;
    observer?.disconnect();
    window.removeEventListener('paste', onPaste);
    document.removeEventListener('keydown', onKeydown);
    clearTimeout(reconnectTimer);
    if (socket) {
      socket.onclose = null;
      socket.close();
      socket = null;
    }
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    gesture = null;
    images.clear();
  }

  function open(url) {
    close();
    init();
    endpoint = url;
    objects = [];
    selected = null;
    active = true;
    attempt = 0;
    zoom = 1;
    pan = { x: 0, y: 0 };
    choose('select');
    resize();
    connect();
  }

  return {
    init,
    open,
    close,
    fit,
    choose,
    zoomBy,
    bringToFront,
    sendToBack,
    deleteSelected,
    clearBoard,
    addImageObject,
    addPresetFrame,
    focusFrame
  };
})();

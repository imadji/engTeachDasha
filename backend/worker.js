// Отдельный Worker: действующий API уроков остаётся на прежнем адресе.
import { DurableObject } from 'cloudflare:workers';
const json = (data, status = 200) => Response.json(data, { status });
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(v => v.toString(16).padStart(2, '0')).join('');
const validId = id => /^[a-zA-Z0-9-]{8,80}$/.test(id || '');

// SQLite-backed storage и hibernation WebSocket API.
export class BoardRoom extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.ctx = ctx; }
  async fetch(request) {
    const url = new URL(request.url), path = url.pathname;
    if (path === '/catalog/list') {
      const records = await this.ctx.storage.list({ prefix: 'board:' });
      return json([...records.values()].filter(b => !b.deleted).map(({ id, title, createdAt }) => ({ id, title, createdAt })));
    }
    if (path === '/catalog/get') return json(await this.ctx.storage.get(url.searchParams.get('key')) || null);
    if (path === '/catalog/put') { const body = await request.json(); await this.ctx.storage.put(body.key, body.value); return json({ success: true }); }
    if (path === '/init') { await this.ctx.storage.put('board', { objects: [], revision: 0 }); return json({ success: true }); }
    if (path === '/delete') {
      await this.ctx.storage.put('board', { objects: [], revision: 0, deleted: true });
      for (const ws of this.ctx.getWebSockets()) ws.close(4004, 'Board deleted');
      return json({ success: true });
    }
    const board = await this.ctx.storage.get('board');
    if (!board || board.deleted) return json({ error: 'Доска не найдена' }, 404);
    if (path === '/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'WebSocket required' }, 426);
      if (this.ctx.getWebSockets().length >= 20) return json({ error: 'Комната заполнена' }, 429);
      const pair = new WebSocketPair(); this.ctx.acceptWebSocket(pair[1]);
      pair[1].send(JSON.stringify({ type: 'state', state: board }));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return json(board);
  }
  // Операции сериализуются транзакцией; подтверждение получает и отправитель.
  async webSocketMessage(ws, raw) {
    try {
      if (typeof raw !== 'string' || raw.length > 600000) fail('Слишком большой запрос');
      const m = JSON.parse(raw); let board;
      const validateObject = o => {
        if (!o || !validId(o.id) || !['frame','pen','rect','ellipse','line','arrow','text','sticker','image'].includes(o.type)) fail('Некорректный объект');
        if (!['x','y','w','h'].every(k => Number.isFinite(o[k]) && Math.abs(o[k]) <= 100000) || o.w <= 0 || o.h <= 0) fail('Некорректные координаты');
        if (o.text !== undefined && (typeof o.text !== 'string' || o.text.length > 10000)) fail('Слишком длинный текст');
        if (o.title !== undefined && (typeof o.title !== 'string' || o.title.length > 160)) fail('Слишком длинное название фрейма');
        if (o.type === 'image') {
          const isData = typeof o.url === 'string' && /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(o.url);
          if (isData) {
            if (o.url.length > 480000) fail('Изображение слишком большое (макс. ~350 КБ после сжатия)');
          } else {
            const u = new URL(o.url);
            if (!['http:','https:'].includes(u.protocol)) fail('Нужна HTTP(S) ссылка или изображение');
          }
        }
        if (o.type === 'pen' && (!Array.isArray(o.points) || o.points.length > 2000 || !o.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)))) fail('Некорректный рисунок');
      };
      await this.ctx.storage.transaction(async tx => {
        board = await tx.get('board');
        if (!board || board.deleted) fail('Доска удалена');
        const list = board.objects;
        if (m.type === 'add' || m.type === 'update') {
          const o = m.object;
          validateObject(o);
          const i = list.findIndex(v => v.id === o.id);
          if (m.type === 'add' && i < 0) { if (list.length >= 400) fail('Лимит: 400 объектов'); list.push(o); }
          else if (i >= 0) list[i] = o;
        } else if (m.type === 'batch' && Array.isArray(m.objects)) {
          if (m.objects.length > 200) fail('Слишком много объектов в пакете');
          for (const o of m.objects) {
            validateObject(o);
            const i = list.findIndex(v => v.id === o.id);
            if (i >= 0) list[i] = o;
          }
        } else if (m.type === 'delete') board.objects = list.filter(o => o.id !== m.objectId);
        else if (m.type === 'clear') board.objects = [];
        else if (m.type === 'reorder') {
          if (!Number.isInteger(m.newIndex)) fail('Некорректный слой');
          const i = list.findIndex(o => o.id === m.objectId);
          if (i >= 0) { const [o] = list.splice(i, 1); list.splice(Math.max(0, Math.min(list.length, m.newIndex)), 0, o); }
        } else fail('Неизвестная операция');
        if (JSON.stringify(board).length > 1800000) fail('Лимит размера доски достигнут');
        board.revision++; await tx.put('board', board);
      });
      const message = JSON.stringify({ type: 'state', state: board, ack: m.opId });
      for (const peer of this.ctx.getWebSockets()) { try { peer.send(message); } catch { peer.close(); } }
    } catch (error) {
      const board = await this.ctx.storage.get('board');
      ws.send(JSON.stringify({ type: 'error', error: error.message, state: board }));
    }
  }
  webSocketClose(ws, code) { ws.close(code, 'Closed'); }
  webSocketError(ws) { ws.close(1011, 'Connection error'); }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (origin && !allowed.includes(origin)) return json({ error: 'Origin запрещён' }, 403);
    const headers = { 'Access-Control-Allow-Origin': origin || allowed[0] || '', 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-Teacher-Token', 'Cache-Control': 'no-store' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const catalog = env.BOARDS.get(env.BOARDS.idFromName('catalog-v1'));
    const get = async key => (await catalog.fetch('https://internal/catalog/get?key=' + encodeURIComponent(key))).json();
    const put = async (key, value) => { const r = await catalog.fetch('https://internal/catalog/put', { method: 'POST', body: JSON.stringify({ key, value }) }); if (!r.ok) fail('Ошибка каталога', 500); };
    const reqUrl = new URL(request.url);
    const providedToken = request.headers.get('X-Teacher-Token') || reqUrl.searchParams.get('token') || '';
    const teacher = async () => !!env.TEACHER_TOKEN && await digest(providedToken) === await digest(env.TEACHER_TOKEN);
    const requireTeacher = async () => { if (!await teacher()) fail('Введите корректный токен учителя', 403); };
    const rtk = async (path, body) => {
      if (!env.REALTIMEKIT_APP_ID || !env.REALTIMEKIT_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) fail('RealtimeKit ещё не настроен на сервере', 503);
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/realtime/kit/${env.REALTIMEKIT_APP_ID}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${env.REALTIMEKIT_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
      const data = await r.json();
      if (!r.ok || data.success !== true) { console.error('RealtimeKit', r.status, data.errors); fail('Ошибка RealtimeKit: проверьте App ID, токен и presets', 502); }
      return data.data;
    };
    try {
      const url = new URL(request.url), parts = url.pathname.split('/').filter(Boolean);
      let response;
      if (parts[0] === 'health') response = json({ success: true });
      else if (parts[0] === 'boards' && parts.length === 1 && request.method === 'GET') { await requireTeacher(); response = await catalog.fetch('https://internal/catalog/list'); }
      else if (parts[0] === 'boards' && parts.length === 1 && request.method === 'POST') {
        await requireTeacher(); const body = await request.json(), title = String(body.title || '').trim();
        if (!title || title.length > 120) fail('Название: от 1 до 120 символов');
        const id = crypto.randomUUID(), key = crypto.randomUUID();
        const board = { id, title, createdAt: new Date().toISOString(), keyHash: await digest(key) };
        await env.BOARDS.get(env.BOARDS.idFromName(id)).fetch('https://internal/init', { method: 'POST' });
        await put('board:' + id, board); response = json({ success: true, board: { id, title, createdAt: board.createdAt }, key });
      } else if (parts[0] === 'boards' && parts.length >= 2 && parts.length <= 3) {
        const id = parts[1], action = parts[2]; if (!validId(id)) fail('Неверный ID');
        const board = await get('board:' + id); if (!board || board.deleted) fail('Доска не найдена', 404);
        const host = await teacher();
        if (action === 'invite' && request.method === 'POST') {
          await requireTeacher(); const key = crypto.randomUUID(); board.keyHash = await digest(key); await put('board:' + id, board); response = json({ key });
        } else if (!action && request.method === 'DELETE') {
          await requireTeacher(); board.deleted = true; await put('board:' + id, board); response = await env.BOARDS.get(env.BOARDS.idFromName(id)).fetch('https://internal/delete', { method: 'POST' });
        } else if (request.method === 'GET' && (!action || action === 'ws')) {
          const key = url.searchParams.get('key') || '';
          if (!host && (!key || await digest(key) !== board.keyHash)) fail('Нужна ссылка-приглашение на доску', 403);
          if (action === 'ws') return await env.BOARDS.get(env.BOARDS.idFromName(id)).fetch(new Request('https://internal/ws', request));
          response = json({ id, title: board.title, createdAt: board.createdAt });
        } else fail('Метод не поддерживается', 405);
      } else if (parts[0] === 'calls' && parts.length === 1 && request.method === 'POST') {
        await requireTeacher(); const meeting = await rtk('/meetings', { title: 'English Flashcards' });
        if (!meeting?.id) fail('RealtimeKit не вернул ID', 502);
        const key = crypto.randomUUID(); await put('call:' + meeting.id, { keyHash: await digest(key), createdAt: Date.now() }); response = json({ roomId: meeting.id, key });
      } else if (parts[0] === 'calls' && parts.length === 3 && parts[2] === 'token' && request.method === 'POST') {
        const id = parts[1]; if (!validId(id)) fail('Неверный ID');
        const body = await request.json(), room = await get('call:' + id);
        if (!room || Date.now() - room.createdAt > 86400000) fail('Приглашение истекло или не найдено', 404);
        const host = await teacher();
        if (!host && await digest(String(body.key || '')) !== room.keyHash) fail('Неверная ссылка-приглашение', 403);
        const participant = await rtk(`/meetings/${id}/participants`, { name: String(body.name || 'Участник').slice(0, 40), preset_name: host ? env.REALTIMEKIT_HOST_PRESET : env.REALTIMEKIT_STUDENT_PRESET, custom_participant_id: crypto.randomUUID() });
        if (!participant?.token) fail('RealtimeKit не вернул токен', 502); response = json({ token: participant.token });
      } else response = json({ error: 'Эндпоинт не найден' }, 404);
      const output = new Response(response.body, response); for (const [k,v] of Object.entries(headers)) output.headers.set(k,v); return output;
    } catch (error) { return new Response(JSON.stringify({ error: error.message }), { status: error.status || 500, headers: { ...headers, 'Content-Type': 'application/json' } }); }
  }
};

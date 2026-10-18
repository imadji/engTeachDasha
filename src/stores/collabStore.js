/**
 * Хранилище совместной работы: интерактивные доски и видеозвонки.
 * Общается с Worker'ом flashcards-collaboration (Durable Objects + RealtimeKit).
 */
import { ref } from 'vue';
import { COLLAB_API_URL } from '../config/api.js';
import { useAppStore } from './appStore.js';

const boards = ref([]);
const boardsLoading = ref(false);

const { toast, teacherToken } = useAppStore();

/**
 * Запрос к Worker'у совместной работы с авторизацией и понятными ошибками
 */
async function collabFetch(path, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (teacherToken.value) headers['X-Teacher-Token'] = teacherToken.value;

  let response;
  try {
    response = await fetch(`${COLLAB_API_URL}${path}`, { ...options, headers });
  } catch {
    throw new Error('Сервер совместной работы недоступен. Проверьте соединение.');
  }

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const message = data?.error || `Ошибка сервера (${response.status})`;
    throw Object.assign(new Error(message), { status: response.status });
  }

  return data;
}

/**
 * Проверка токена учителя. При успехе возвращает true, иначе открывает модальное окно.
 * onSuccess вызывается после успешной авторизации.
 */
function requireTeacher(onSuccess = null, hint = 'для этого действия') {
  const { teacherToken, openAuthModal } = useAppStore();
  if (teacherToken.value) return true;
  openAuthModal(hint, onSuccess);
  return false;
}

/**
 * GET /boards — загрузка списка досок (только для учителя)
 */
async function fetchBoards() {
  boardsLoading.value = true;
  try {
    const list = await collabFetch('/boards');
    boards.value = Array.isArray(list) ? list : [];
  } catch (error) {
    boards.value = [];
    if (error.status === 403) { useAppStore().clearTeacherToken(); requireTeacher(() => fetchBoards(), 'для просмотра досок'); }
    else toast(error.message, true);
  } finally {
    boardsLoading.value = false;
  }
}

/**
 * POST /boards — создание доски
 */
async function createBoard(title) {
  const result = await collabFetch('/boards', { method: 'POST', body: JSON.stringify({ title }) });
  if (result.board) boards.value.unshift(result.board);
  toast('Доска создана');
  return result;
}

/**
 * DELETE /boards/:id — удаление доски
 */
async function deleteBoard(boardId) {
  await collabFetch(`/boards/${encodeURIComponent(boardId)}`, { method: 'DELETE' });
  boards.value = boards.value.filter((b) => b.id !== boardId);
  toast('Доска удалена');
}

/**
 * POST /boards/:id/invite — генерация новой ссылки-приглашения
 */
async function createBoardInvite(boardId) {
  const result = await collabFetch(`/boards/${encodeURIComponent(boardId)}/invite`, { method: 'POST' });
  return result.key;
}

/**
 * GET /boards/:id?key= — проверка доступа к доске (ученик по ключу, учитель по токену)
 */
async function getBoard(boardId, boardKey) {
  const query = boardKey ? `?key=${encodeURIComponent(boardKey)}` : '';
  return collabFetch(`/boards/${encodeURIComponent(boardId)}${query}`);
}

/**
 * URL WebSocket для синхронизации доски.
 * Учитель передаёт токен через query (?token=), ученик — ключ приглашения (?key=).
 */
function buildBoardSocketUrl(boardId, { boardKey = null, teacherTokenValue = null } = {}) {
  const base = COLLAB_API_URL.replace(/^http/, 'ws');
  const params = new URLSearchParams();
  if (boardKey) params.set('key', boardKey);
  if (teacherTokenValue) params.set('token', teacherTokenValue);
  const query = params.toString();
  return `${base}/boards/${encodeURIComponent(boardId)}/ws${query ? `?${query}` : ''}`;
}

/* ---------- Видеозвонки ---------- */

/**
 * POST /calls — создание комнаты звонка (учитель)
 */
async function createCallRoom() {
  const result = await collabFetch('/calls', { method: 'POST', body: JSON.stringify({}) });
  toast('Комната звонка создана');
  return result; // { roomId, key }
}

/**
 * POST /calls/:roomId/token — получение токена участника RealtimeKit
 */
async function getCallToken(roomId, name, callKey) {
  const result = await collabFetch(`/calls/${encodeURIComponent(roomId)}/token`, {
    method: 'POST',
    body: JSON.stringify({ name, key: callKey || '' })
  });
  return result.token;
}

/**
 * Ссылка-приглашение на звонок для ученика
 */
function buildCallInviteLink(roomId, callKey) {
  return `${location.origin}${location.pathname}?call=${encodeURIComponent(roomId)}&key=${encodeURIComponent(callKey)}`;
}

/**
 * Ссылка-приглашение на доску для ученика
 */
function buildBoardInviteLink(boardId, boardKey) {
  return `${location.origin}${location.pathname}?board=${encodeURIComponent(boardId)}&key=${encodeURIComponent(boardKey)}`;
}

export function useCollabStore() {
  return {
    boards,
    boardsLoading,
    collabFetch,
    requireTeacher,
    fetchBoards,
    createBoard,
    deleteBoard,
    createBoardInvite,
    getBoard,
    buildBoardSocketUrl,
    createCallRoom,
    getCallToken,
    buildCallInviteLink,
    buildBoardInviteLink
  };
}

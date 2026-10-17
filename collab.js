/**
 * ==========================================================================
 * English Flashcards — Модуль совместной работы (доски + видеозвонки)
 *
 * Отвечает за:
 *  - общение с отдельным Cloudflare Worker (доски, RealtimeKit-токены);
 *  - список досок и их создание/удаление;
 *  - запуск звонка из урока или с доски и открытие звонка по ссылке;
 *  - маршрутизацию URL-параметров (?board=...&key=... / ?call=...&key=...).
 *
 * Зависимости: board.js (canvas-доска), call.js (WebRTC через RealtimeKit).
 * ==========================================================================
 */

// Базовый URL Worker'а досок и звонков (настраивается в collaboration-config.js)
const COLLAB_API_URL = (window.COLLABORATION_CONFIG?.apiUrl || '').replace(/\/+$/, '');

// Ключ в sessionStorage для токена учителя: переживает перезагрузку вкладки,
// но не сохраняется в localStorage вместе с уроками.
const TEACHER_TOKEN_KEY = 'englishFlashcardsTeacherToken';

/**
 * Проверка, что Worker совместной работы настроен и доступен
 */
function isCollaborationConfigured() {
  return /^https?:\/\//i.test(COLLAB_API_URL);
}

/**
 * Сохранение токена учителя в sessionStorage (только на время вкладки)
 */
function rememberTeacherToken(token) {
  state.teacherToken = token || null;
  try {
    if (token) sessionStorage.setItem(TEACHER_TOKEN_KEY, token);
    else sessionStorage.removeItem(TEACHER_TOKEN_KEY);
  } catch {
    /* sessionStorage может быть недоступен в приватном режиме */
  }
}

function restoreTeacherToken() {
  try {
    state.teacherToken = sessionStorage.getItem(TEACHER_TOKEN_KEY) || null;
  } catch {
    state.teacherToken = null;
  }
}

/**
 * Запрос к Worker'у совместной работы с авторизацией и понятными ошибками
 */
async function collabFetch(path, options = {}) {
  if (!isCollaborationConfigured()) {
    throw new Error(
      'Совместная работа не настроена. Укажите адрес Worker в файле collaboration-config.js.'
    );
  }

  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (state.teacherToken) headers['X-Teacher-Token'] = state.teacherToken;

  let response;
  try {
    response = await fetch(`${COLLAB_API_URL}${path}`, { ...options, headers });
  } catch {
    throw new Error('Сервер совместной работы недоступен. Проверьте соединение и адрес Worker.');
  }

  if (response.status === 401 || response.status === 403) {
    state.teacherToken = null;
    try {
      sessionStorage.removeItem(TEACHER_TOKEN_KEY);
    } catch {
      /* игнорируем */
    }
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
 * Запрос токена учителя перед операциями, доступными только учителю
 */
async function ensureTeacherAccess(actionHint) {
  if (state.teacherToken) return true;

  const token = prompt(
    `Действие доступно только учителю.\n\nВведите токен учителя (${actionHint}).\nОн задаётся на сервере переменной TEACHER_TOKEN и не сохраняется в браузере.`
  );
  if (!token || !token.trim()) return false;

  rememberTeacherToken(token.trim());
  try {
    // /health публичный, поэтому для проверки токена используем защищённый список досок.
    await collabFetch('/boards');
    return true;
  } catch (error) {
    showToast(error.message, true);
    return false;
  }
}

/* ==========================================================================
   Экран «Доски»: список, создание, удаление, открытие
   ========================================================================== */

/**
 * Загрузка списка досок учителя с сервера
 */
async function fetchBoards() {
  // Список досок доступен только учителю и требует токен.
  if (state.role === 'teacher' && !(await ensureTeacherAccess('для просмотра интерактивных досок'))) {
    state.boardsLoading = false;
    renderBoardsScreen();
    return;
  }

  state.boardsLoading = true;
  renderBoardsScreen();
  try {
    const list = await collabFetch('/boards');
    state.boards = Array.isArray(list) ? list : [];
  } catch (error) {
    state.boards = [];
    if (error.status === 403) {
      showToast('Нужен токен учителя для просмотра досок', true);
    } else {
      showToast(error.message, true);
    }
  } finally {
    state.boardsLoading = false;
    renderBoardsScreen();
  }
}

/**
 * Отрисовка плиток досок на главном экране (вкладка «Доски»)
 */
function renderBoardsScreen() {
  const grid = document.getElementById('boardsGrid');
  const emptyState = document.getElementById('emptyBoardsState');
  const loadingState = document.getElementById('loadingBoardsState');
  const createBtn = document.getElementById('createBoardBtn');
  const emptyCreateBtn = document.getElementById('emptyCreateBoardBtn');
  if (!grid) return;

  const isTeacher = state.role === 'teacher';
  createBtn?.classList.toggle('hidden', !isTeacher);
  emptyCreateBtn?.classList.toggle('hidden', !isTeacher);

  if (state.boardsLoading) {
    loadingState?.classList.remove('hidden');
    grid.classList.add('hidden');
    emptyState.classList.add('hidden');
    return;
  }

  loadingState?.classList.add('hidden');
  grid.innerHTML = '';

  if (state.boards.length === 0) {
    grid.classList.add('hidden');
    emptyState.classList.remove('hidden');
    return;
  }

  grid.classList.remove('hidden');
  emptyState.classList.add('hidden');

  state.boards.forEach((board) => {
    const cardEl = document.createElement('article');
    cardEl.className = 'lesson-card';
    cardEl.setAttribute('tabindex', '0');

    const top = document.createElement('div');
    top.className = 'lesson-card-top';

    const badges = document.createElement('div');
    badges.className = 'lesson-card-badges';

    const left = document.createElement('div');
    left.className = 'lesson-badges-left';

    const kindBadge = document.createElement('span');
    kindBadge.className = 'badge badge-published';
    kindBadge.textContent = 'Доска';

    const dateBadgeLeft = document.createElement('span');
    dateBadgeLeft.className = 'badge-date';
    dateBadgeLeft.textContent = formatDate(board.createdAt);

    left.append(kindBadge, dateBadgeLeft);

    const rightBadge = document.createElement('span');
    rightBadge.className = 'badge badge-cards';
    rightBadge.textContent = 'Совместная работа';

    badges.append(left, rightBadge);

    const titleEl = document.createElement('h3');
    titleEl.className = 'lesson-card-title';
    titleEl.textContent = board.title || 'Без названия';

    const excerptEl = document.createElement('p');
    excerptEl.className = 'lesson-card-excerpt';
    excerptEl.textContent =
      'Рисуйте, добавляйте стикеры, фигуры и изображения. Все участники видят изменения в реальном времени.';

    top.append(badges, titleEl, excerptEl);

    const footer = document.createElement('div');
    footer.className = 'lesson-card-footer';

    const openLink = document.createElement('span');
    openLink.className = 'lesson-open-link';
    openLink.innerHTML = `
      <span>Открыть доску</span>
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="5" y1="12" x2="19" y2="12"></line>
        <polyline points="12 5 19 12 12 19"></polyline>
      </svg>
    `;

    footer.appendChild(openLink);

    if (isTeacher) {
      const actions = document.createElement('div');
      actions.className = 'lesson-card-actions';

      const shareBtn = document.createElement('button');
      shareBtn.type = 'button';
      shareBtn.className = 'icon-btn';
      shareBtn.title = 'Создать ссылку-приглашение для ученика';
      shareBtn.setAttribute('aria-label', 'Поделиться доской');
      shareBtn.innerHTML = `
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="18" cy="5" r="3"></circle>
          <circle cx="6" cy="12" r="3"></circle>
          <circle cx="18" cy="19" r="3"></circle>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
        </svg>
      `;
      shareBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        requestBoardInviteLink(board.id);
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'icon-btn danger';
      deleteBtn.title = 'Удалить доску';
      deleteBtn.setAttribute('aria-label', 'Удалить доску');
      deleteBtn.innerHTML = `
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      `;
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        requestDeleteBoard(board);
      });

      actions.append(shareBtn, deleteBtn);
      footer.appendChild(actions);
    }

    cardEl.append(top, footer);
    cardEl.addEventListener('click', () => openBoardScreen(board.id, state.role === 'teacher' ? null : state.currentBoardKey));
    cardEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openBoardScreen(board.id, state.role === 'teacher' ? null : state.currentBoardKey);
      }
    });

    grid.appendChild(cardEl);
  });
}

/**
 * Создание новой доски через модальное окно
 */
function openCreateBoardModal() {
  const input = document.getElementById('boardTitleInput');
  const error = document.getElementById('boardTitleError');
  input.value = '';
  error.textContent = '';
  openModal('boardModal');
  setTimeout(() => input.focus(), 50);
}

async function handleBoardFormSubmit(event) {
  event.preventDefault();
  const input = document.getElementById('boardTitleInput');
  const error = document.getElementById('boardTitleError');
  const title = input.value.trim();

  if (!title) {
    error.textContent = 'Введите название доски.';
    input.focus();
    return;
  }

  try {
    const result = await collabFetch('/boards', { method: 'POST', body: JSON.stringify({ title }) });
    closeModal('boardModal');
    showToast('Доска создана');
    state.boards.unshift(result.board);
    renderBoardsScreen();
    if (result.key) {
      state.currentBoardId = result.board.id;
      await showBoardInviteLink(result.key);
    }
  } catch (error_) {
    error.textContent = error_.message;
    showToast(error_.message, true);
  }
}

/**
 * Удаление доски с подтверждением
 */
function requestDeleteBoard(board) {
  document.getElementById('confirmModalTitle').textContent = 'Удалить доску?';
  document.getElementById('confirmModalMessage').textContent =
    `Доска «${board.title || 'Без названия'}» и её содержимое будут удалены безвозвратно.`;

  state.confirmCallback = async () => {
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Удаление...';
    try {
      await collabFetch(`/boards/${encodeURIComponent(board.id)}`, { method: 'DELETE' });
      state.boards = state.boards.filter((b) => b.id !== board.id);
      closeModal('confirmModal');
      showToast('Доска удалена');
      renderBoardsScreen();
    } catch (error) {
      showToast(error.message, true);
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Удалить';
    }
  };

  openModal('confirmModal');
}

/**
 * Запрос новой ссылки-приглашения к доске (учитель) и показ её
 */
async function requestBoardInviteLink(boardId) {
  if (!(await ensureTeacherAccess('для создания ссылки на доску'))) return;
  try {
    const result = await collabFetch(`/boards/${encodeURIComponent(boardId)}/invite`, { method: 'POST' });
    await showBoardInviteLink(result.key);
  } catch (error) {
    showToast(error.message, true);
  }
}

/**
 * Показ ссылки-приглашения к доске в модальном окне
 */
async function showBoardInviteLink(key) {
  const boardId = state.currentBoardId;
  if (!boardId) return;

  const link = `${location.origin}${location.pathname}?board=${encodeURIComponent(boardId)}&key=${encodeURIComponent(key)}`;
  showShareLink(
    'Ссылка на доску',
    'Отправьте ученику эту ссылку: он откроет доску и увидит ваши рисунки и правки в реальном времени.',
    link
  );
}

/**
 * Открытие доски и подключение к WebSocket-синхронизации
 */
async function openBoardScreen(boardId, boardKey = null) {
  if (!boardId) return;

  state.currentBoardId = boardId;
  state.currentBoardKey = boardKey;

  // Проверяем доступность доски и получаем её название
  let board = null;
  try {
    const query = boardKey ? `?key=${encodeURIComponent(boardKey)}` : '';
    board = await collabFetch(`/boards/${encodeURIComponent(boardId)}${query}`);
  } catch (error) {
    showToast(error.message, true);
    state.currentBoardId = null;
    return;
  }

  document.getElementById('boardTitle').textContent = board.title || 'Доска';
  document.getElementById('boardShareInviteBtn').classList.toggle('hidden', state.role !== 'teacher');
  document.getElementById('boardStartCallBtn').classList.toggle('hidden', state.role !== 'teacher');

  switchScreen('screenBoard');
  BoardCanvas.open(buildBoardSocketUrl(boardId, boardKey));
}

/**
 * Построение URL WebSocket для синхронизации доски
 */
function buildBoardSocketUrl(boardId, boardKey) {
  const base = COLLAB_API_URL.replace(/^http/, 'ws');
  const query = boardKey ? `?key=${encodeURIComponent(boardKey)}` : '';
  return `${base}/boards/${encodeURIComponent(boardId)}/ws${query}`;
}

/* ==========================================================================
   Видеозвонки: создание комнаты, приглашение, присоединение
   ========================================================================== */

/**
 * Создание новой комнаты звонка (учитель) и показ ссылки ученику
 */
async function createCallRoom(originHint) {
  if (!(await ensureTeacherAccess('для создания видеозвонка'))) return;

  try {
    const result = await collabFetch('/calls', { method: 'POST', body: JSON.stringify({}) });
    state.currentCallRoomId = result.roomId;
    state.currentCallKey = result.key;
    state.lastLessonContext = originHint || null;

    const link = `${location.origin}${location.pathname}?call=${encodeURIComponent(result.roomId)}&key=${encodeURIComponent(result.key)}`;
    showShareLink(
      'Ссылка на звонок',
      'Отправьте ученику эту ссылку: он присоединится к звонку по нажатию. Пока ссылка не открыта, вы можете подключиться первым.',
      link
    );
    enterCallScreen(result.roomId);
  } catch (error) {
    showToast(error.message, true);
  }
}

/**
 * Переход на экран звонка и заполнение данных комнаты
 */
function enterCallScreen(roomId) {
  if (!roomId) return;

  state.currentCallRoomId = roomId;
  document.getElementById('callRoomId').textContent = `Комната: ${roomId.slice(0, 8)}`;
  document.getElementById('callJoinView').classList.remove('hidden');
  document.getElementById('callVideosWrap').classList.add('hidden');
  document.getElementById('callControls').classList.add('hidden');
  document.getElementById('shareCallInviteBtn').classList.toggle('hidden', state.role !== 'teacher');
  switchScreen('screenCall');
}

/**
 * Присоединение к комнате звонка: запрос токена и инициализация RealtimeKit
 */
async function joinCallRoom(roomId) {
  const nameInput = document.getElementById('callNameInput');
  const name = nameInput.value.trim() || (state.role === 'teacher' ? 'Учитель' : 'Ученик');
  const joinBtn = document.getElementById('joinCallBtn');

  if (VideoCall.active || VideoCall.joining) return;

  joinBtn.disabled = true;
  joinBtn.textContent = 'Подключение...';

  try {
    await VideoCall.join(async () => {
      const result = await collabFetch(`/calls/${encodeURIComponent(roomId)}/token`, {
        method: 'POST',
        body: JSON.stringify({ name, key: state.currentCallKey || '' })
      });
      return result.token;
    });
    showToast('Вы в комнате звонка');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    joinBtn.disabled = false;
    joinBtn.textContent = 'Присоединиться';
  }
}

/**
 * Возврат из звонка на предыдущий экран (урок или доска)
 */
function exitCallScreen() {
  VideoCall.leave();
  const context = state.lastLessonContext;
  state.currentCallRoomId = null;
  state.currentCallKey = null;

  if (context?.screen === 'board' && context.boardId) {
    openBoardScreen(context.boardId, context.boardKey || null);
  } else if (context?.lessonId) {
    openLessonScreen(context.lessonId);
  } else if (state.role) {
    goHomeScreen();
  } else {
    showRoleSelectionScreen();
  }
}

/* ==========================================================================
   Модальное окно «Поделиться ссылкой»
   ========================================================================== */

function showShareLink(title, description, link) {
  document.getElementById('shareModalTitle').textContent = title;
  document.getElementById('shareModalDesc').textContent = description;
  document.getElementById('shareModalLink').value = link;
  openModal('shareModal');
}

async function copyShareLink() {
  const field = document.getElementById('shareModalLink');
  try {
    await navigator.clipboard.writeText(field.value);
    showToast('Ссылка скопирована в буфер обмена');
  } catch {
    field.select();
    showToast('Скопируйте ссылку вручную: поле выделено');
  }
}

/* ==========================================================================
   Переключение вкладок главного экрана (Уроки / Доски)
   ========================================================================== */

function setHomeTab(tab) {
  state.homeTab = tab === 'boards' ? 'boards' : 'lessons';
  const isLessons = state.homeTab === 'lessons';

  document.getElementById('tabLessonsBtn')?.classList.toggle('active', isLessons);
  document.getElementById('tabBoardsBtn')?.classList.toggle('active', !isLessons);
  document.getElementById('tabLessonsBtn')?.setAttribute('aria-selected', String(isLessons));
  document.getElementById('tabBoardsBtn')?.setAttribute('aria-selected', String(!isLessons));

  document.getElementById('homeLessonsPane')?.classList.toggle('hidden', !isLessons);
  document.getElementById('homeBoardsPane')?.classList.toggle('hidden', isLessons);

  if (!isLessons) fetchBoards();
  else renderHomeScreen();
}

/* ==========================================================================
   Маршрутизация URL-параметров для ученика (?board= / ?call=)
   ========================================================================== */

async function handleUrlRouting() {
  const params = new URLSearchParams(location.search);
  const boardId = params.get('board');
  const callId = params.get('call');
  const key = params.get('key') || '';

  if (callId) {
    // Ученик (или учитель) приходит по ссылке на звонок
    state.currentCallRoomId = callId;
    state.currentCallKey = key;
    state.lastLessonContext = null;

    if (!state.role) {
      // Роль ещё не выбрана: для ссылки на звонок подставляем роль ученика по умолчанию
      state.role = 'student';
      try {
        localStorage.setItem(ROLE_STORAGE_KEY, 'student');
      } catch {
        /* игнорируем */
      }
      updateHeaderRoleUI();
    }
    enterCallScreen(callId);
    return;
  }

  if (boardId) {
    state.currentBoardKey = key;
    if (!state.role) {
      state.role = 'student';
      try {
        localStorage.setItem(ROLE_STORAGE_KEY, 'student');
      } catch {
        /* игнорируем */
      }
      updateHeaderRoleUI();
    }
    openBoardScreen(boardId, key);
  }
}

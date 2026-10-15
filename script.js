/**
 * ==========================================================================
 * English Flashcards — Облачная версия веб-приложения (Чистый JavaScript ES6+)
 * Все уроки и карточки хранятся в облаке через API Cloudflare Workers.
 * В localStorage сохраняется ТОЛЬКО выбранная роль пользователя (ученик/учитель).
 * ==========================================================================
 */

// Базовый URL облачного API для работы с уроками
const API_BASE_URL = 'https://flashcards-api.vip-obzor.workers.dev';

// Единственный ключ в localStorage — только для сохранения выбранной роли ('student' | 'teacher')
const ROLE_STORAGE_KEY = 'englishFlashcardsUserRole';

// Ключ для хранения выбранной темы оформления ('light' | 'dark')
const THEME_STORAGE_KEY = 'englishFlashcardsTheme';

// Заглушка на случай, если ссылка на картинку битая или недоступна (SVG Data URI)
const FALLBACK_IMAGE_URI =
  'data:image/svg+xml;charset=UTF-8,' +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="600" height="450" viewBox="0 0 600 450">
      <rect width="600" height="450" fill="#eef3f8"/>
      <g fill="none" stroke="#9bb2c9" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" transform="translate(240, 155)">
        <rect x="0" y="0" width="120" height="95" rx="14" fill="#ffffff"/>
        <circle cx="38" cy="34" r="10"/>
        <path d="M8 82 L45 48 L75 74 L95 56 L112 82"/>
      </g>
      <text x="300" y="295" text-anchor="middle" font-family="Nunito, sans-serif" font-size="18" font-weight="700" fill="#6486ac">
        Изображение недоступно
      </text>
      <text x="300" y="320" text-anchor="middle" font-family="Inter, sans-serif" font-size="13" fill="#8e94a0">
        Проверьте ссылку на картинку (URL)
      </text>
    </svg>
  `);

// Глобальное состояние приложения
const state = {
  role: null,                 // 'student' | 'teacher' | null
  lessons: [],                // массив уроков, загруженных с сервера
  isLoading: false,           // идёт ли загрузка списка уроков
  isSaving: false,            // идёт ли запрос сохранения / удаления
  currentLessonId: null,      // ID открытого урока
  previewAsStudent: false,    // режим предпросмотра «как ученик» для учителя
  modalDraftCards: [],        // временный массив карточек внутри модального окна урока
  trainingIndex: 0,           // индекс текущей карточки в режиме тренировки
  isTrainingFlipped: false,   // перевёрнута ли карточка в тренировке
  draggedCardIndex: null,     // индекс перетаскиваемой карточки (drag-and-drop)
  confirmCallback: null       // колбэк для модального окна подтверждения удаления
};

/* ==========================================================================
   Настройка библиотеки Marked и безопасный рендеринг Markdown
   ========================================================================== */

if (window.marked) {
  window.marked.setOptions({
    breaks: true,
    gfm: true
  });
}

/**
 * Рендеринг Markdown-текста в HTML с базовой очисткой опасных тегов
 */
function renderMarkdown(markdownText) {
  const source = typeof markdownText === 'string' ? markdownText.trim() : '';
  if (!source) return '';

  if (window.marked && typeof window.marked.parse === 'function') {
    const rawHtml = window.marked.parse(source);
    // Удаляем потенциально опасные теги <script> и <iframe>
    return rawHtml
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  }

  // Запасной вариант, если CDN marked не загрузился
  const escaped = source
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<p>${escaped.replace(/\n/g, '<br>')}</p>`;
}

/**
 * Получение краткого текстового описания из Markdown (без спецсимволов разметки) для карточки урока
 */
function stripMarkdownPreview(markdownText) {
  if (!markdownText || typeof markdownText !== 'string') return '';
  return markdownText
    .replace(/^[#>*`-]+\s*/gm, '')
    .replace(/(\*\*|__|\*|_|`|~~)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ==========================================================================
   Работа с темой оформления (светлая / тёмная, сохраняется в localStorage)
   ========================================================================== */

/**
 * Применение темы оформления к документу и обновление подсказки кнопки
 */
function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');

  const themeBtn = document.getElementById('themeToggleBtn');
  if (themeBtn) {
    themeBtn.title = isDark ? 'Включить светлую тему' : 'Включить тёмную тему';
  }
}

/**
 * Загрузка сохранённой темы из localStorage (по умолчанию — светлая)
 */
function loadSavedTheme() {
  try {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === 'dark' || savedTheme === 'light') {
      return savedTheme;
    }
  } catch (err) {
    console.warn('Не удалось прочитать тему из localStorage:', err);
  }
  return 'light';
}

/**
 * Переключение темы оформления и сохранение выбора
 */
function toggleTheme() {
  const isDarkNow = document.documentElement.getAttribute('data-theme') === 'dark';
  const nextTheme = isDarkNow ? 'light' : 'dark';

  applyTheme(nextTheme);

  try {
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  } catch (err) {
    console.warn('Не удалось сохранить тему в localStorage:', err);
  }
}

/* ==========================================================================
   Работа с ролью пользователя (единственная настройка в localStorage)
   ========================================================================== */

/**
 * Чтение сохранённой роли из localStorage и удаление старого ключа уроков, если он оставался
 */
function loadSavedRole() {
  try {
    // Полностью убираем старое локальное хранилище уроков, если оно было раньше
    localStorage.removeItem('englishFlashcardsApp');

    const savedRole = localStorage.getItem(ROLE_STORAGE_KEY);
    if (savedRole === 'student' || savedRole === 'teacher') {
      return savedRole;
    }
  } catch (err) {
    console.warn('Не удалось прочитать роль из localStorage:', err);
  }
  return null;
}

/**
 * Сохранение выбранной роли в localStorage
 */
function saveUserRole(role) {
  state.role = role;
  state.previewAsStudent = false;
  try {
    if (role === 'student' || role === 'teacher') {
      localStorage.setItem(ROLE_STORAGE_KEY, role);
    } else {
      localStorage.removeItem(ROLE_STORAGE_KEY);
    }
  } catch (err) {
    console.warn('Не удалось сохранить роль в localStorage:', err);
  }
  updateHeaderRoleUI();
}

/**
 * Проверяет, работает ли сейчас интерфейс в режиме учителя (с учётом кнопки «Предпросмотр»)
 */
function isEffectiveTeacherView() {
  return state.role === 'teacher' && !state.previewAsStudent;
}

/**
 * Обновление шапки приложения в соответствии с выбранной ролью
 */
function updateHeaderRoleUI() {
  const roleControls = document.getElementById('headerRoleControls');
  const roleBadge = document.getElementById('currentRoleBadge');
  const subtitle = document.getElementById('headerRoleSubtitle');

  if (!state.role) {
    roleControls.classList.add('hidden');
    subtitle.textContent = 'Интерактивные уроки и карточки';
    return;
  }

  roleControls.classList.remove('hidden');

  if (state.role === 'teacher') {
    roleBadge.textContent = 'Роль: Учитель';
    roleBadge.classList.add('is-teacher');
    subtitle.textContent = 'Кабинет преподавателя';
  } else {
    roleBadge.textContent = 'Роль: Ученик';
    roleBadge.classList.remove('is-teacher');
    subtitle.textContent = 'Кабинет ученика';
  }
}

/* ==========================================================================
   Работа с облачным API (GET /lessons, POST /lessons, DELETE /lessons/{id})
   ========================================================================== */

/**
 * Нормализация объекта урока, полученного с сервера
 */
function normalizeLesson(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const cards = Array.isArray(raw.cards)
    ? raw.cards
        .filter((c) => c && typeof c === 'object')
        .map((c) => ({
          imageUrl: typeof c.imageUrl === 'string' ? c.imageUrl.trim() : '',
          text: typeof c.text === 'string' ? c.text.trim() : '',
          translation: typeof c.translation === 'string' ? c.translation.trim() : ''
        }))
    : [];

  return {
    id: raw.id ? String(raw.id) : '',
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'Без названия',
    // Поддержка новых полей teacherScript / studentScript и обратной совместимости со старым script
    teacherScript:
      typeof raw.teacherScript === 'string'
        ? raw.teacherScript
        : typeof raw.script === 'string'
          ? raw.script
          : '',
    studentScript: typeof raw.studentScript === 'string' ? raw.studentScript : '',
    published: Boolean(raw.published),
    cards,
    createdAt: raw.createdAt || new Date().toISOString()
  };
}

/**
 * GET /lessons — Загрузка всех уроков из облака
 */
async function fetchLessonsFromApi() {
  state.isLoading = true;
  hideNetworkErrorBanner();
  renderHomeScreen();

  try {
    const response = await fetch(`${API_BASE_URL}/lessons`, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }

    const data = await response.json();
    const rawList = Array.isArray(data)
      ? data
      : data && Array.isArray(data.lessons)
        ? data.lessons
        : [];

    state.lessons = rawList
      .map(normalizeLesson)
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch (error) {
    console.error('Ошибка при загрузке уроков с API:', error);
    showNetworkErrorBanner('Не удалось загрузить данные. Проверьте соединение.');
    showToast('Не удалось загрузить данные. Проверьте соединение.', true);
  } finally {
    state.isLoading = false;
    renderHomeScreen();

    // Если сейчас открыт экран конкретного урока — обновим и его
    if (state.currentLessonId && document.getElementById('screenLesson').classList.contains('active')) {
      const updated = getCurrentLesson();
      if (updated) {
        renderLessonScreen();
      }
    }
  }
}

/**
 * POST /lessons — Сохранение (создание или обновление) урока в облаке
 * Принимает объект урока, возвращает обновлённый урок с id от сервера
 */
async function saveLessonToApi(lessonPayload) {
  const bodyToSend = {
    ...(lessonPayload.id ? { id: lessonPayload.id } : {}),
    title: lessonPayload.title,
    teacherScript: lessonPayload.teacherScript || '',
    studentScript: lessonPayload.studentScript || '',
    published: Boolean(lessonPayload.published),
    cards: Array.isArray(lessonPayload.cards)
      ? lessonPayload.cards.map((c) => ({
          imageUrl: c.imageUrl,
          text: c.text,
          translation: c.translation || ''
        }))
      : [],
    createdAt: lessonPayload.createdAt || new Date().toISOString()
  };

  const response = await fetch(`${API_BASE_URL}/lessons`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(bodyToSend)
  });

  if (!response.ok) {
    throw new Error(`Ошибка сохранения (${response.status})`);
  }

  const result = await response.json();
  const savedId = (result && result.id) || bodyToSend.id;
  const normalized = normalizeLesson({
    ...bodyToSend,
    id: savedId
  });

  // Обновляем локальный кэш уроков в оперативной памяти
  const existingIndex = state.lessons.findIndex((item) => item.id === normalized.id);
  if (existingIndex !== -1) {
    state.lessons[existingIndex] = normalized;
  } else {
    state.lessons.unshift(normalized);
  }

  return normalized;
}

/**
 * DELETE /lessons/{id} — Удаление урока из облака
 */
async function deleteLessonFromApi(lessonId) {
  const response = await fetch(`${API_BASE_URL}/lessons/${encodeURIComponent(lessonId)}`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Ошибка удаления (${response.status})`);
  }

  state.lessons = state.lessons.filter((item) => item.id !== lessonId);
}

/* ==========================================================================
   Вспомогательные функции интерфейса
   ========================================================================== */

function getCurrentLesson() {
  return state.lessons.find((lesson) => lesson.id === state.currentLessonId) || null;
}

function formatDate(isoString) {
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  } catch {
    return '';
  }
}

function pluralizeCards(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return `${count} карточка`;
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return `${count} карточки`;
  }
  return `${count} карточек`;
}

function attachImageWithFallback(imgElement, url, altText = '') {
  imgElement.alt = altText;
  imgElement.onerror = () => {
    imgElement.onerror = null;
    imgElement.src = FALLBACK_IMAGE_URI;
  };
  imgElement.src = url && url.trim() ? url.trim() : FALLBACK_IMAGE_URI;
}

function showToast(message, isError = false) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast${isError ? ' toast-error' : ''}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.25s ease';
    setTimeout(() => toast.remove(), 260);
  }, 3200);
}

function showNetworkErrorBanner(message) {
  const banner = document.getElementById('networkErrorBanner');
  const msgEl = document.getElementById('networkErrorMessage');
  if (msgEl && message) {
    msgEl.textContent = message;
  }
  banner.classList.remove('hidden');
}

function hideNetworkErrorBanner() {
  document.getElementById('networkErrorBanner').classList.add('hidden');
}

/* ==========================================================================
   Навигация между экранами (SPA-подобное переключение CSS-классов)
   ========================================================================== */

function switchScreen(screenId) {
  const screens = document.querySelectorAll('.screen');
  screens.forEach((screen) => {
    screen.classList.toggle('active', screen.id === screenId);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Показ экрана выбора роли («Я ученик» / «Я учитель»)
 */
function showRoleSelectionScreen() {
  state.currentLessonId = null;
  state.previewAsStudent = false;
  hideNetworkErrorBanner();
  switchScreen('screenRole');
}

/**
 * Выбор роли и переход к списку уроков
 */
function selectRoleAndEnter(role) {
  saveUserRole(role);
  state.currentLessonId = null;
  switchScreen('screenHome');
  fetchLessonsFromApi();
}

/**
 * Переход на главный экран со списком уроков для текущей роли
 */
function goHomeScreen() {
  if (!state.role) {
    showRoleSelectionScreen();
    return;
  }
  state.currentLessonId = null;
  state.previewAsStudent = false;
  renderHomeScreen();
  switchScreen('screenHome');
}

/**
 * Открытие страницы конкретного урока
 */
function openLessonScreen(lessonId) {
  const lesson = state.lessons.find((item) => item.id === lessonId);
  if (!lesson) {
    goHomeScreen();
    return;
  }

  // Защита: ученик может открывать только опубликованные уроки
  if (state.role === 'student' && !lesson.published) {
    showToast('Этот урок находится в черновиках и пока недоступен', true);
    goHomeScreen();
    return;
  }

  state.currentLessonId = lesson.id;
  renderLessonScreen();
  switchScreen('screenLesson');
}

/**
 * Открытие полноэкранного режима тренировки с 3D-карточками
 */
function openTrainingScreen() {
  const lesson = getCurrentLesson();
  if (!lesson || !lesson.cards || lesson.cards.length === 0) {
    showToast('В этом уроке пока нет флеш-карточек для тренировки', true);
    return;
  }
  state.trainingIndex = 0;
  state.isTrainingFlipped = false;
  renderTrainingScreen();
  switchScreen('screenTraining');
}

/* ==========================================================================
   Отрисовка Главного экрана (Учитель видит все уроки, Ученик — опубликованные)
   ========================================================================== */

function renderHomeScreen() {
  if (!state.role) return;

  const isTeacher = state.role === 'teacher';
  const homeTitle = document.getElementById('homeTitle');
  const homeSubtitle = document.getElementById('homeSubtitle');
  const createBtn = document.getElementById('openCreateLessonBtn');
  const emptyCreateBtn = document.getElementById('emptyCreateLessonBtn');
  const loadingState = document.getElementById('loadingLessonsState');
  const grid = document.getElementById('lessonsGrid');
  const emptyState = document.getElementById('emptyLessonsState');
  const emptyTitle = document.getElementById('emptyLessonsTitle');
  const emptyDesc = document.getElementById('emptyLessonsDesc');

  // Заголовки и кнопки в зависимости от роли
  if (isTeacher) {
    homeTitle.textContent = 'Все уроки (Кабинет учителя)';
    homeSubtitle.textContent = 'Управляйте опубликованными уроками и черновиками, скриптами и флеш-карточками';
    createBtn.classList.remove('hidden');
    emptyCreateBtn.classList.remove('hidden');
  } else {
    homeTitle.textContent = 'Доступные уроки';
    homeSubtitle.textContent = 'Выберите урок для изучения конспекта и тренировки слов по флеш-карточкам';
    createBtn.classList.add('hidden');
    emptyCreateBtn.classList.add('hidden');
  }

  // Если данные загружаются с сервера — показываем спиннер и скелетоны
  if (state.isLoading) {
    loadingState.classList.remove('hidden');
    grid.classList.add('hidden');
    emptyState.classList.add('hidden');
    return;
  }

  loadingState.classList.add('hidden');
  grid.innerHTML = '';

  // Ученик видит ТОЛЬКО опубликованные уроки (published === true)
  const visibleLessons = isTeacher
    ? state.lessons
    : state.lessons.filter((lesson) => lesson.published === true);

  if (visibleLessons.length === 0) {
    grid.classList.add('hidden');
    emptyState.classList.remove('hidden');

    if (isTeacher) {
      emptyTitle.textContent = 'У вас пока нет ни одного урока в облаке';
      emptyDesc.textContent = 'Нажмите «Создать урок», чтобы добавить первый урок, Markdown-скрипты и карточки.';
    } else {
      emptyTitle.textContent = 'Опубликованных уроков пока нет';
      emptyDesc.textContent = 'Когда преподаватель опубликует уроки, они сразу появятся на этой странице.';
    }
    return;
  }

  grid.classList.remove('hidden');
  emptyState.classList.add('hidden');

  visibleLessons.forEach((lesson) => {
    const cardEl = document.createElement('article');
    cardEl.className = `lesson-card${!lesson.published ? ' is-draft' : ''}`;
    cardEl.setAttribute('tabindex', '0');

    const topDiv = document.createElement('div');
    topDiv.className = 'lesson-card-top';

    const badgesDiv = document.createElement('div');
    badgesDiv.className = 'lesson-card-badges';

    const leftBadges = document.createElement('div');
    leftBadges.className = 'lesson-badges-left';

    // Метка «Опубликован» / «Черновик» для учителя
    if (isTeacher) {
      const statusBadge = document.createElement('span');
      statusBadge.className = `badge ${lesson.published ? 'badge-published' : 'badge-draft'}`;
      statusBadge.textContent = lesson.published ? 'Опубликован' : 'Черновик';
      leftBadges.appendChild(statusBadge);
    }

    const countBadge = document.createElement('span');
    countBadge.className = 'badge badge-cards';
    countBadge.textContent = pluralizeCards(lesson.cards ? lesson.cards.length : 0);
    leftBadges.appendChild(countBadge);

    const dateBadge = document.createElement('span');
    dateBadge.className = 'badge-date';
    dateBadge.textContent = formatDate(lesson.createdAt);

    badgesDiv.append(leftBadges, dateBadge);

    const titleEl = document.createElement('h3');
    titleEl.className = 'lesson-card-title';
    titleEl.textContent = lesson.title;

    // Краткое превью скрипта на карточке
    const previewSource = isTeacher
      ? lesson.studentScript || lesson.teacherScript
      : lesson.studentScript;
    const cleanExcerpt = stripMarkdownPreview(previewSource);

    const excerptEl = document.createElement('p');
    excerptEl.className = 'lesson-card-excerpt';
    excerptEl.textContent = cleanExcerpt || 'Нажмите, чтобы открыть материалы урока и флеш-карточки.';

    topDiv.append(badgesDiv, titleEl, excerptEl);

    const footerDiv = document.createElement('div');
    footerDiv.className = 'lesson-card-footer';

    const openLink = document.createElement('span');
    openLink.className = 'lesson-open-link';
    openLink.innerHTML = `
      <span>Открыть урок</span>
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="5" y1="12" x2="19" y2="12"></line>
        <polyline points="12 5 19 12 12 19"></polyline>
      </svg>
    `;

    footerDiv.appendChild(openLink);

    // Кнопки быстрого редактирования и удаления только для учителя
    if (isTeacher) {
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'lesson-card-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'icon-btn';
      editBtn.title = 'Редактировать урок';
      editBtn.setAttribute('aria-label', 'Редактировать урок');
      editBtn.innerHTML = `
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 20h9"></path>
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
        </svg>
      `;
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openLessonModal(lesson);
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'icon-btn danger';
      deleteBtn.title = 'Удалить урок';
      deleteBtn.setAttribute('aria-label', 'Удалить урок');
      deleteBtn.innerHTML = `
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      `;
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        requestDeleteLesson(lesson.id);
      });

      actionsDiv.append(editBtn, deleteBtn);
      footerDiv.appendChild(actionsDiv);
    }

    cardEl.append(topDiv, footerDiv);

    cardEl.addEventListener('click', () => openLessonScreen(lesson.id));
    cardEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openLessonScreen(lesson.id);
      }
    });

    grid.appendChild(cardEl);
  });
}

/* ==========================================================================
   Отрисовка Экрана урока (Скрипты в Markdown + Сетка флеш-карточек)
   ========================================================================== */

function renderLessonScreen() {
  const lesson = getCurrentLesson();
  if (!lesson) return;

  const isTeacherRole = state.role === 'teacher';
  const isTeacherEffective = isEffectiveTeacherView();

  // Заголовок и мета-информация
  document.getElementById('lessonViewTitle').textContent = lesson.title;
  document.getElementById('lessonMetaInfo').textContent =
    `${formatDate(lesson.createdAt)} • ${pluralizeCards(lesson.cards.length)}`;

  // Бейдж статуса урока (Опубликован / Черновик) для учителя
  const statusBadge = document.getElementById('lessonStatusBadge');
  if (isTeacherRole) {
    statusBadge.classList.remove('hidden', 'badge-published', 'badge-draft');
    statusBadge.classList.add(lesson.published ? 'badge-published' : 'badge-draft');
    statusBadge.textContent = lesson.published ? 'Опубликован' : 'Черновик';
  } else {
    statusBadge.classList.add('hidden');
  }

  // Плашка предпросмотра «как ученик»
  const previewBanner = document.getElementById('studentPreviewNotice');
  previewBanner.classList.toggle('hidden', !(isTeacherRole && state.previewAsStudent));

  // Кнопки в шапке урока
  const startTrainingBtn = document.getElementById('startTrainingBtn');
  startTrainingBtn.disabled = lesson.cards.length === 0;

  const previewBtn = document.getElementById('togglePreviewStudentBtn');
  const previewBtnText = document.getElementById('togglePreviewBtnText');
  const editLessonBtn = document.getElementById('editCurrentLessonBtn');
  const deleteLessonBtn = document.getElementById('deleteCurrentLessonBtn');

  if (isTeacherRole) {
    previewBtn.classList.remove('hidden');
    previewBtnText.textContent = state.previewAsStudent ? 'Режим учителя' : 'Предпросмотр';
  } else {
    previewBtn.classList.add('hidden');
  }

  editLessonBtn.classList.toggle('hidden', !isTeacherEffective);
  deleteLessonBtn.classList.toggle('hidden', !isTeacherEffective);

  // 1. Блок «Скрипт для учителя» (виден только в режиме учителя)
  const teacherPanel = document.getElementById('teacherScriptPanel');
  const teacherContent = document.getElementById('teacherScriptContent');

  if (isTeacherEffective) {
    teacherPanel.classList.remove('hidden');
    if (lesson.teacherScript && lesson.teacherScript.trim()) {
      teacherContent.innerHTML = renderMarkdown(lesson.teacherScript);
      teacherContent.classList.remove('script-empty-placeholder');
    } else {
      teacherContent.innerHTML = '<p>Методический скрипт для учителя пока не заполнен. Нажмите «Редактировать урок», чтобы добавить план занятия в формате Markdown.</p>';
      teacherContent.classList.add('script-empty-placeholder');
    }
  } else {
    teacherPanel.classList.add('hidden');
  }

  // 2. Блок «Скрипт урока» (studentScript — виден и ученику, и учителю)
  const studentHeading = document.getElementById('studentScriptHeading');
  const studentContent = document.getElementById('studentScriptContent');
  studentHeading.textContent = isTeacherEffective ? 'Скрипт урока (для ученика)' : 'Скрипт урока';

  if (lesson.studentScript && lesson.studentScript.trim()) {
    studentContent.innerHTML = renderMarkdown(lesson.studentScript);
    studentContent.classList.remove('script-empty-placeholder');
  } else {
    studentContent.innerHTML = isTeacherEffective
      ? '<p>Скрипт для ученика не заполнен. Вы можете добавить его через «Редактировать урок».</p>'
      : '<p>К этому уроку нет текстового конспекта. Переходите к карточкам и режиму тренировки ниже!</p>';
    studentContent.classList.add('script-empty-placeholder');
  }

  // Заголовок секции флеш-карточек и кнопки добавления
  const cardsHint = document.getElementById('cardsSectionHint');
  const openAddCardBtn = document.getElementById('openAddCardBtn');
  const emptyAddCardBtn = document.getElementById('emptyAddCardBtn');
  const emptyCardsDesc = document.getElementById('emptyCardsDesc');

  if (isTeacherEffective) {
    cardsHint.textContent = 'Перетаскивайте карточки мышкой (drag-and-drop) или используйте стрелки для изменения порядка (сохраняется автоматически в облаке)';
    openAddCardBtn.classList.remove('hidden');
    emptyAddCardBtn.classList.remove('hidden');
    emptyCardsDesc.textContent = 'Добавьте карточки со ссылками на картинки и английскими фразами.';
  } else {
    cardsHint.textContent = 'Изучите карточки перед запуском «Режима тренировки»';
    openAddCardBtn.classList.add('hidden');
    emptyAddCardBtn.classList.add('hidden');
    emptyCardsDesc.textContent = 'Преподаватель ещё не добавил флеш-карточки в этот урок.';
  }

  // Сетка флеш-карточек
  const cardsGrid = document.getElementById('cardsGrid');
  const emptyCardsState = document.getElementById('emptyCardsState');
  cardsGrid.innerHTML = '';

  if (lesson.cards.length === 0) {
    cardsGrid.classList.add('hidden');
    emptyCardsState.classList.remove('hidden');
    return;
  }

  cardsGrid.classList.remove('hidden');
  emptyCardsState.classList.add('hidden');

  lesson.cards.forEach((card, index) => {
    const cardItem = document.createElement('article');
    cardItem.className = 'flashcard-item';
    if (isTeacherEffective) {
      cardItem.setAttribute('draggable', 'true');
      cardItem.dataset.index = String(index);
    }

    const imageWrap = document.createElement('div');
    imageWrap.className = 'flashcard-image-wrap';

    const img = document.createElement('img');
    img.className = 'flashcard-image';
    img.loading = 'lazy';
    attachImageWithFallback(img, card.imageUrl, card.text);

    const numberBadge = document.createElement('span');
    numberBadge.className = 'flashcard-number-badge';
    numberBadge.textContent = `#${index + 1}`;

    imageWrap.append(img, numberBadge);

    const bodyDiv = document.createElement('div');
    bodyDiv.className = 'flashcard-body';

    const textEl = document.createElement('h3');
    textEl.className = 'flashcard-text';
    textEl.textContent = card.text;
    bodyDiv.appendChild(textEl);

    if (card.translation && card.translation.trim()) {
      const trEl = document.createElement('p');
      trEl.className = 'flashcard-translation';
      trEl.textContent = card.translation;
      bodyDiv.appendChild(trEl);
    }

    cardItem.append(imageWrap, bodyDiv);

    // Панель управления карточкой (только для учителя вне режима предпросмотра)
    if (isTeacherEffective) {
      const toolbar = document.createElement('div');
      toolbar.className = 'flashcard-toolbar';

      const reorderGroup = document.createElement('div');
      reorderGroup.className = 'reorder-group';

      const moveUpBtn = document.createElement('button');
      moveUpBtn.type = 'button';
      moveUpBtn.className = 'icon-btn';
      moveUpBtn.title = 'Переместить карточку выше / левее';
      moveUpBtn.disabled = index === 0 || state.isSaving;
      moveUpBtn.innerHTML = `
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="18 15 12 9 6 15"></polyline>
        </svg>
      `;
      moveUpBtn.addEventListener('click', () => moveCardOnLessonPage(index, index - 1));

      const moveDownBtn = document.createElement('button');
      moveDownBtn.type = 'button';
      moveDownBtn.className = 'icon-btn';
      moveDownBtn.title = 'Переместить карточку ниже / правее';
      moveDownBtn.disabled = index === lesson.cards.length - 1 || state.isSaving;
      moveDownBtn.innerHTML = `
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      `;
      moveDownBtn.addEventListener('click', () => moveCardOnLessonPage(index, index + 1));

      const dragLabel = document.createElement('span');
      dragLabel.className = 'drag-handle-hint';
      dragLabel.title = 'Перетащите карточку мышью для смены позиции';
      dragLabel.textContent = '⋮⋮';

      reorderGroup.append(moveUpBtn, moveDownBtn, dragLabel);

      const actionsGroup = document.createElement('div');
      actionsGroup.className = 'card-actions-group';

      const editCardBtn = document.createElement('button');
      editCardBtn.type = 'button';
      editCardBtn.className = 'icon-btn';
      editCardBtn.title = 'Редактировать карточку';
      editCardBtn.disabled = state.isSaving;
      editCardBtn.innerHTML = `
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 20h9"></path>
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
        </svg>
      `;
      editCardBtn.addEventListener('click', () => openSingleCardModal(index));

      const deleteCardBtn = document.createElement('button');
      deleteCardBtn.type = 'button';
      deleteCardBtn.className = 'icon-btn danger';
      deleteCardBtn.title = 'Удалить карточку';
      deleteCardBtn.disabled = state.isSaving;
      deleteCardBtn.innerHTML = `
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      `;
      deleteCardBtn.addEventListener('click', () => requestDeleteCard(index));

      actionsGroup.append(editCardBtn, deleteCardBtn);
      toolbar.append(reorderGroup, actionsGroup);
      cardItem.appendChild(toolbar);

      setupCardDragAndDrop(cardItem, index);
    }

    cardsGrid.appendChild(cardItem);
  });
}

/**
 * Настройка Drag-and-Drop перетаскивания карточек на странице урока
 */
function setupCardDragAndDrop(cardElement, index) {
  cardElement.addEventListener('dragstart', (e) => {
    state.draggedCardIndex = index;
    cardElement.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  cardElement.addEventListener('dragend', () => {
    state.draggedCardIndex = null;
    cardElement.classList.remove('dragging');
    document.querySelectorAll('.flashcard-item').forEach((el) => el.classList.remove('drag-over'));
  });

  cardElement.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (state.draggedCardIndex !== null && state.draggedCardIndex !== index) {
      cardElement.classList.add('drag-over');
    }
  });

  cardElement.addEventListener('dragleave', () => {
    cardElement.classList.remove('drag-over');
  });

  cardElement.addEventListener('drop', (e) => {
    e.preventDefault();
    cardElement.classList.remove('drag-over');
    const fromIndex = state.draggedCardIndex;
    if (fromIndex !== null && fromIndex !== index) {
      moveCardOnLessonPage(fromIndex, index);
    }
  });
}

/**
 * Изменение порядка карточек на экране урока с синхронизацией в облако (POST /lessons)
 */
async function moveCardOnLessonPage(fromIndex, toIndex) {
  const lesson = getCurrentLesson();
  if (!lesson || state.isSaving) return;
  if (toIndex < 0 || toIndex >= lesson.cards.length) return;

  const previousCards = lesson.cards.map((c) => ({ ...c }));
  const [movedCard] = lesson.cards.splice(fromIndex, 1);
  lesson.cards.splice(toIndex, 0, movedCard);

  renderLessonScreen();

  state.isSaving = true;
  try {
    await saveLessonToApi(lesson);
  } catch (error) {
    console.error('Не удалось сохранить новый порядок карточек:', error);
    lesson.cards = previousCards;
    showToast('Ошибка при сохранении порядка карточек в облаке', true);
  } finally {
    state.isSaving = false;
    renderLessonScreen();
  }
}

/* ==========================================================================
   Режим тренировки (3D-переворот карточки, навигация, прогресс)
   ========================================================================== */

function renderTrainingScreen() {
  const lesson = getCurrentLesson();
  if (!lesson || lesson.cards.length === 0) return;

  const total = lesson.cards.length;
  if (state.trainingIndex >= total) state.trainingIndex = total - 1;
  if (state.trainingIndex < 0) state.trainingIndex = 0;

  const currentCard = lesson.cards[state.trainingIndex];

  document.getElementById('trainingLessonTitle').textContent = lesson.title;
  document.getElementById('trainingCounter').textContent = `${state.trainingIndex + 1} / ${total}`;

  const progressPercent = ((state.trainingIndex + 1) / total) * 100;
  document.getElementById('trainingProgressFill').style.width = `${progressPercent}%`;

  const cardScene = document.getElementById('trainingCardContainer');
  cardScene.classList.toggle('is-flipped', state.isTrainingFlipped);

  const frontImg = document.getElementById('trainingCardImage');
  const backThumb = document.getElementById('trainingCardBackThumb');
  attachImageWithFallback(frontImg, currentCard.imageUrl, 'Иллюстрация флеш-карточки');
  attachImageWithFallback(backThumb, currentCard.imageUrl, '');

  // Лицевая сторона: английское слово под картинкой
  document.getElementById('trainingCardText').textContent = currentCard.text;

  // Обратная сторона: перевод на русском языке
  document.getElementById('trainingCardTranslation').textContent =
    currentCard.translation && currentCard.translation.trim()
      ? currentCard.translation
      : 'Перевод не указан';

  document.getElementById('prevCardBtn').disabled = state.trainingIndex === 0;
  document.getElementById('nextCardBtn').disabled = state.trainingIndex === total - 1;
}

function toggleTrainingFlip() {
  state.isTrainingFlipped = !state.isTrainingFlipped;
  const cardScene = document.getElementById('trainingCardContainer');
  cardScene.classList.toggle('is-flipped', state.isTrainingFlipped);
}

function stepTrainingCard(direction) {
  const lesson = getCurrentLesson();
  if (!lesson) return;

  const nextIndex = state.trainingIndex + direction;
  if (nextIndex < 0 || nextIndex >= lesson.cards.length) return;

  if (state.isTrainingFlipped) {
    state.isTrainingFlipped = false;
    document.getElementById('trainingCardContainer').classList.remove('is-flipped');
    setTimeout(() => {
      state.trainingIndex = nextIndex;
      renderTrainingScreen();
    }, 180);
  } else {
    state.trainingIndex = nextIndex;
    renderTrainingScreen();
  }
}

/* ==========================================================================
   Модальное окно создания / редактирования урока (включая управление карточками)
   ========================================================================== */

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('hidden');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('hidden');
}

function isValidUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'data:';
  } catch {
    return false;
  }
}

/**
 * Открытие полного редактора урока для учителя
 */
function openLessonModal(lesson = null) {
  const titleEl = document.getElementById('lessonModalTitle');
  const idInput = document.getElementById('lessonIdInput');
  const titleInput = document.getElementById('lessonTitleInput');
  const publishedInput = document.getElementById('lessonPublishedInput');
  const teacherScriptInput = document.getElementById('teacherScriptInput');
  const studentScriptInput = document.getElementById('studentScriptInput');
  const errorEl = document.getElementById('lessonTitleError');

  errorEl.textContent = '';
  titleInput.classList.remove('input-error');
  resetInlineCardEditor();

  if (lesson) {
    titleEl.textContent = 'Редактировать урок';
    idInput.value = lesson.id;
    titleInput.value = lesson.title;
    publishedInput.checked = Boolean(lesson.published);
    teacherScriptInput.value = lesson.teacherScript || '';
    studentScriptInput.value = lesson.studentScript || '';
    state.modalDraftCards = lesson.cards.map((c) => ({ ...c }));
  } else {
    titleEl.textContent = 'Создать новый урок';
    idInput.value = '';
    titleInput.value = '';
    publishedInput.checked = true;
    teacherScriptInput.value = '';
    studentScriptInput.value = '';
    state.modalDraftCards = [];
  }

  renderModalDraftCardsList();
  openModal('lessonModal');
  setTimeout(() => titleInput.focus(), 50);
}

/**
 * Сброс встроенной мини-формы карточки внутри модального окна урока
 */
function resetInlineCardEditor() {
  document.getElementById('inlineCardEditIndex').value = '-1';
  document.getElementById('inlineCardImageUrl').value = '';
  document.getElementById('inlineCardText').value = '';
  document.getElementById('inlineCardTranslation').value = '';
  document.getElementById('inlineCardError').textContent = '';
  document.getElementById('inlineSaveCardBtn').textContent = '+ Добавить карточку';
  document.getElementById('inlineCancelCardEditBtn').classList.add('hidden');
}

/**
 * Отрисовка списка флеш-карточек внутри модального окна урока
 */
function renderModalDraftCardsList() {
  const listEl = document.getElementById('modalCardsList');
  const countEl = document.getElementById('modalCardsCount');
  countEl.textContent = String(state.modalDraftCards.length);
  listEl.innerHTML = '';

  if (state.modalDraftCards.length === 0) {
    const emptyNote = document.createElement('p');
    emptyNote.className = 'form-hint';
    emptyNote.textContent = 'Карточки ещё не добавлены. Заполните поля выше и нажмите «+ Добавить карточку».';
    listEl.appendChild(emptyNote);
    return;
  }

  state.modalDraftCards.forEach((card, index) => {
    const row = document.createElement('div');
    row.className = 'modal-card-row';

    const info = document.createElement('div');
    info.className = 'modal-card-row-info';

    const thumb = document.createElement('img');
    thumb.className = 'modal-card-thumb';
    attachImageWithFallback(thumb, card.imageUrl, card.text);

    const texts = document.createElement('div');
    texts.className = 'modal-card-texts';

    const en = document.createElement('div');
    en.className = 'modal-card-en';
    en.textContent = `${index + 1}. ${card.text}`;

    const tr = document.createElement('div');
    tr.className = 'modal-card-tr';
    tr.textContent = card.translation || 'Без перевода';

    texts.append(en, tr);
    info.append(thumb, texts);

    const actions = document.createElement('div');
    actions.className = 'modal-card-row-actions';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'icon-btn';
    upBtn.title = 'Выше';
    upBtn.disabled = index === 0;
    upBtn.textContent = '↑';
    upBtn.addEventListener('click', () => {
      const [item] = state.modalDraftCards.splice(index, 1);
      state.modalDraftCards.splice(index - 1, 0, item);
      renderModalDraftCardsList();
    });

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'icon-btn';
    downBtn.title = 'Ниже';
    downBtn.disabled = index === state.modalDraftCards.length - 1;
    downBtn.textContent = '↓';
    downBtn.addEventListener('click', () => {
      const [item] = state.modalDraftCards.splice(index, 1);
      state.modalDraftCards.splice(index + 1, 0, item);
      renderModalDraftCardsList();
    });

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'icon-btn';
    editBtn.title = 'Редактировать карточку';
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', () => {
      document.getElementById('inlineCardEditIndex').value = String(index);
      document.getElementById('inlineCardImageUrl').value = card.imageUrl;
      document.getElementById('inlineCardText').value = card.text;
      document.getElementById('inlineCardTranslation').value = card.translation || '';
      document.getElementById('inlineCardError').textContent = '';
      document.getElementById('inlineSaveCardBtn').textContent = 'Обновить карточку';
      document.getElementById('inlineCancelCardEditBtn').classList.remove('hidden');
      document.getElementById('inlineCardImageUrl').focus();
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'icon-btn danger';
    delBtn.title = 'Удалить карточку';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => {
      state.modalDraftCards.splice(index, 1);
      resetInlineCardEditor();
      renderModalDraftCardsList();
    });

    actions.append(upBtn, downBtn, editBtn, delBtn);
    row.append(info, actions);
    listEl.appendChild(row);
  });
}

/**
 * Добавление или обновление карточки во встроенном редакторе внутри модалки урока
 */
function handleInlineCardSave() {
  const editIndex = Number(document.getElementById('inlineCardEditIndex').value);
  const urlInput = document.getElementById('inlineCardImageUrl');
  const textInput = document.getElementById('inlineCardText');
  const trInput = document.getElementById('inlineCardTranslation');
  const errorEl = document.getElementById('inlineCardError');

  const imageUrl = urlInput.value.trim();
  const text = textInput.value.trim();
  const translation = trInput.value.trim();

  errorEl.textContent = '';

  if (!imageUrl || !isValidUrl(imageUrl)) {
    errorEl.textContent = 'Укажите корректный URL картинки (начинается с https:// или http://).';
    urlInput.focus();
    return;
  }

  if (!text) {
    errorEl.textContent = 'Введите текст на английском для карточки.';
    textInput.focus();
    return;
  }

  // Валидация: перевод на русском обязателен — без него карточку создать нельзя
  if (!translation) {
    errorEl.textContent = 'Укажите перевод на русский — он показывается на обратной стороне карточки.';
    trInput.focus();
    return;
  }

  const cardObj = { imageUrl, text, translation };

  if (editIndex >= 0 && editIndex < state.modalDraftCards.length) {
    state.modalDraftCards[editIndex] = cardObj;
  } else {
    state.modalDraftCards.push(cardObj);
  }

  resetInlineCardEditor();
  renderModalDraftCardsList();
}

/**
 * Сохранение урока из модального окна на сервер (POST /lessons)
 */
async function handleLessonFormSubmit(event) {
  event.preventDefault();
  if (state.isSaving) return;

  const idInput = document.getElementById('lessonIdInput');
  const titleInput = document.getElementById('lessonTitleInput');
  const publishedInput = document.getElementById('lessonPublishedInput');
  const teacherScriptInput = document.getElementById('teacherScriptInput');
  const studentScriptInput = document.getElementById('studentScriptInput');
  const errorEl = document.getElementById('lessonTitleError');
  const saveBtn = document.getElementById('saveLessonBtn');

  const title = titleInput.value.trim();
  if (!title) {
    errorEl.textContent = 'Пожалуйста, введите название урока.';
    titleInput.classList.add('input-error');
    titleInput.focus();
    return;
  }

  // Если пользователь ввёл поля новой карточки в мини-форму, но не нажал «+ Добавить карточку», подхватим её
  const pendingUrl = document.getElementById('inlineCardImageUrl').value.trim();
  const pendingText = document.getElementById('inlineCardText').value.trim();
  if (pendingUrl && pendingText && isValidUrl(pendingUrl)) {
    handleInlineCardSave();
  }

  const existingId = idInput.value.trim();
  const existingLesson = existingId ? state.lessons.find((l) => l.id === existingId) : null;

  const payload = {
    id: existingId || undefined,
    title,
    teacherScript: teacherScriptInput.value.trim(),
    studentScript: studentScriptInput.value.trim(),
    published: publishedInput.checked,
    cards: state.modalDraftCards,
    createdAt: existingLesson ? existingLesson.createdAt : new Date().toISOString()
  };

  state.isSaving = true;
  const originalBtnText = saveBtn.textContent;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Сохранение...';

  try {
    const savedLesson = await saveLessonToApi(payload);
    closeModal('lessonModal');
    showToast(existingId ? 'Урок успешно обновлён в облаке' : 'Урок создан и сохранён в облаке');
    state.currentLessonId = savedLesson.id;
    openLessonScreen(savedLesson.id);
  } catch (error) {
    console.error('Ошибка POST /lessons:', error);
    showToast('Не удалось сохранить урок на сервере. Проверьте соединение.', true);
  } finally {
    state.isSaving = false;
    saveBtn.disabled = false;
    saveBtn.textContent = originalBtnText;
  }
}

/* ==========================================================================
   Модальное окно быстрого добавления / редактирования одной карточки со страницы урока
   ========================================================================== */

function openSingleCardModal(cardIndex = -1) {
  const lesson = getCurrentLesson();
  if (!lesson) return;

  const modalTitle = document.getElementById('cardModalTitle');
  const indexInput = document.getElementById('cardEditIndexInput');
  const urlInput = document.getElementById('cardImageUrlInput');
  const textInput = document.getElementById('cardTextInput');
  const translationInput = document.getElementById('cardTranslationInput');
  const urlError = document.getElementById('cardImageUrlError');
  const textError = document.getElementById('cardTextError');
  const translationError = document.getElementById('cardTranslationError');

  urlError.textContent = '';
  textError.textContent = '';
  translationError.textContent = '';
  urlInput.classList.remove('input-error');
  textInput.classList.remove('input-error');
  translationInput.classList.remove('input-error');

  if (cardIndex >= 0 && lesson.cards[cardIndex]) {
    const card = lesson.cards[cardIndex];
    modalTitle.textContent = 'Редактировать карточку';
    indexInput.value = String(cardIndex);
    urlInput.value = card.imageUrl;
    textInput.value = card.text;
    translationInput.value = card.translation || '';
    updateCardImagePreview(card.imageUrl);
  } else {
    modalTitle.textContent = 'Добавить флеш-карточку';
    indexInput.value = '-1';
    urlInput.value = '';
    textInput.value = '';
    translationInput.value = '';
    updateCardImagePreview('');
  }

  openModal('cardModal');
  setTimeout(() => urlInput.focus(), 50);
}

function updateCardImagePreview(url) {
  const wrap = document.getElementById('cardImagePreviewWrap');
  const img = document.getElementById('cardImagePreview');
  const trimmed = url ? url.trim() : '';

  if (!trimmed) {
    wrap.classList.add('hidden');
    img.src = '';
    return;
  }

  wrap.classList.remove('hidden');
  attachImageWithFallback(img, trimmed, 'Предпросмотр карточки');
}

async function handleSingleCardFormSubmit(event) {
  event.preventDefault();
  const lesson = getCurrentLesson();
  if (!lesson || state.isSaving) return;

  const indexInput = document.getElementById('cardEditIndexInput');
  const urlInput = document.getElementById('cardImageUrlInput');
  const textInput = document.getElementById('cardTextInput');
  const translationInput = document.getElementById('cardTranslationInput');
  const urlError = document.getElementById('cardImageUrlError');
  const textError = document.getElementById('cardTextError');
  const translationError = document.getElementById('cardTranslationError');
  const saveCardBtn = document.getElementById('saveCardBtn');

  const imageUrl = urlInput.value.trim();
  const text = textInput.value.trim();
  const translation = translationInput.value.trim();

  let hasError = false;
  urlError.textContent = '';
  textError.textContent = '';
  translationError.textContent = '';
  urlInput.classList.remove('input-error');
  textInput.classList.remove('input-error');
  translationInput.classList.remove('input-error');

  if (!imageUrl || !isValidUrl(imageUrl)) {
    urlError.textContent = 'Укажите корректную ссылку на изображение (https:// или http://).';
    urlInput.classList.add('input-error');
    hasError = true;
  }

  if (!text) {
    textError.textContent = 'Введите слово или фразу на английском.';
    textInput.classList.add('input-error');
    hasError = true;
  }

  // Валидация: перевод на русском обязателен — без него карточку сохранить нельзя
  if (!translation) {
    translationError.textContent = 'Укажите перевод на русский — он показывается на обратной стороне карточки.';
    translationInput.classList.add('input-error');
    hasError = true;
  }

  if (hasError) {
    if (!imageUrl || !isValidUrl(imageUrl)) {
      urlInput.focus();
    } else if (!text) {
      textInput.focus();
    } else {
      translationInput.focus();
    }
    return;
  }

  const editIndex = Number(indexInput.value);
  const updatedCards = lesson.cards.map((c) => ({ ...c }));

  if (editIndex >= 0 && editIndex < updatedCards.length) {
    updatedCards[editIndex] = { imageUrl, text, translation };
  } else {
    updatedCards.push({ imageUrl, text, translation });
  }

  state.isSaving = true;
  const origText = saveCardBtn.textContent;
  saveCardBtn.disabled = true;
  saveCardBtn.textContent = 'Сохранение...';

  try {
    await saveLessonToApi({
      ...lesson,
      cards: updatedCards
    });
    closeModal('cardModal');
    renderLessonScreen();
    showToast(editIndex >= 0 ? 'Карточка обновлена' : 'Карточка добавлена в урок');
  } catch (error) {
    console.error('Ошибка сохранения карточки:', error);
    showToast('Не удалось сохранить карточку на сервере', true);
  } finally {
    state.isSaving = false;
    saveCardBtn.disabled = false;
    saveCardBtn.textContent = origText;
  }
}

/* ==========================================================================
   Удаление урока (DELETE /lessons/{id}) и удаление карточки
   ========================================================================== */

function requestDeleteLesson(lessonId) {
  const lesson = state.lessons.find((item) => item.id === lessonId);
  if (!lesson) return;

  document.getElementById('confirmModalTitle').textContent = 'Удалить урок из облака?';
  document.getElementById('confirmModalMessage').textContent =
    `Вы уверены, что хотите безвозвратно удалить урок «${lesson.title}» (${pluralizeCards(lesson.cards.length)})?`;

  state.confirmCallback = async () => {
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    const origText = confirmBtn.textContent;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Удаление...';
    state.isSaving = true;

    try {
      await deleteLessonFromApi(lessonId);
      closeModal('confirmModal');
      showToast('Урок удалён с сервера');

      if (state.currentLessonId === lessonId) {
        goHomeScreen();
      } else {
        renderHomeScreen();
      }
    } catch (error) {
      console.error('Ошибка DELETE /lessons:', error);
      showToast('Не удалось удалить урок. Проверьте соединение с сервером.', true);
    } finally {
      state.isSaving = false;
      confirmBtn.disabled = false;
      confirmBtn.textContent = origText;
    }
  };

  openModal('confirmModal');
}

function requestDeleteCard(cardIndex) {
  const lesson = getCurrentLesson();
  if (!lesson || !lesson.cards[cardIndex]) return;

  const targetCard = lesson.cards[cardIndex];
  document.getElementById('confirmModalTitle').textContent = 'Удалить карточку?';
  document.getElementById('confirmModalMessage').textContent =
    `Удалить карточку «${targetCard.text}» из урока?`;

  state.confirmCallback = async () => {
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    const origText = confirmBtn.textContent;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Удаление...';
    state.isSaving = true;

    const updatedCards = lesson.cards.filter((_, idx) => idx !== cardIndex);

    try {
      await saveLessonToApi({
        ...lesson,
        cards: updatedCards
      });
      closeModal('confirmModal');
      renderLessonScreen();
      showToast('Карточка удалена');
    } catch (error) {
      console.error('Ошибка удаления карточки:', error);
      showToast('Не удалось сохранить изменения на сервере.', true);
    } finally {
      state.isSaving = false;
      confirmBtn.disabled = false;
      confirmBtn.textContent = origText;
    }
  };

  openModal('confirmModal');
}

/* ==========================================================================
   Инициализация приложения и обработчиков событий
   ========================================================================== */

function setupScriptCollapseButton(btnId, wrapperId, textId, iconId) {
  const btn = document.getElementById(btnId);
  const wrapper = document.getElementById(wrapperId);
  const textEl = document.getElementById(textId);
  const iconEl = document.getElementById(iconId);

  btn.addEventListener('click', () => {
    const isCollapsed = wrapper.classList.toggle('collapsed');
    btn.setAttribute('aria-expanded', String(!isCollapsed));
    textEl.textContent = isCollapsed ? 'Развернуть' : 'Свернуть';
    iconEl.classList.toggle('rotated', isCollapsed);
  });
}

function initApp() {
  // 0. Применяем сохранённую тему оформления (светлая по умолчанию)
  applyTheme(loadSavedTheme());

  // Переключение темы кнопкой в шапке
  document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);

  // 1. Проверяем, была ли ранее выбрана роль в localStorage
  const savedRole = loadSavedRole();
  if (savedRole) {
    state.role = savedRole;
    updateHeaderRoleUI();
    switchScreen('screenHome');
    fetchLessonsFromApi();
  } else {
    updateHeaderRoleUI();
    showRoleSelectionScreen();
  }

  // Кнопки выбора роли на приветственном экране
  document.getElementById('selectStudentRoleBtn').addEventListener('click', () => {
    selectRoleAndEnter('student');
  });
  document.getElementById('selectTeacherRoleBtn').addEventListener('click', () => {
    selectRoleAndEnter('teacher');
  });

  // Кнопка «Сменить роль» в шапке
  document.getElementById('changeRoleBtn').addEventListener('click', () => {
    showRoleSelectionScreen();
  });

  // Клик по логотипу возвращает на главный экран текущей роли (или выбор роли)
  document.getElementById('logoHomeBtn').addEventListener('click', () => {
    if (state.role) {
      goHomeScreen();
    } else {
      showRoleSelectionScreen();
    }
  });

  // Кнопки повторной загрузки данных с сервера
  document.getElementById('retryLoadBtn').addEventListener('click', fetchLessonsFromApi);
  document.getElementById('refreshLessonsBtn').addEventListener('click', fetchLessonsFromApi);

  // Кнопки создания урока (для учителя)
  document.getElementById('openCreateLessonBtn').addEventListener('click', () => openLessonModal(null));
  document.getElementById('emptyCreateLessonBtn').addEventListener('click', () => openLessonModal(null));

  // Навигация и кнопки на странице урока
  document.getElementById('backToHomeBtn').addEventListener('click', goHomeScreen);
  document.getElementById('startTrainingBtn').addEventListener('click', openTrainingScreen);

  // Переключение режима «Предпросмотр» (учитель смотрит глазами ученика)
  document.getElementById('togglePreviewStudentBtn').addEventListener('click', () => {
    state.previewAsStudent = !state.previewAsStudent;
    renderLessonScreen();
  });
  document.getElementById('exitPreviewModeBtn').addEventListener('click', () => {
    state.previewAsStudent = false;
    renderLessonScreen();
  });

  document.getElementById('editCurrentLessonBtn').addEventListener('click', () => {
    const lesson = getCurrentLesson();
    if (lesson) openLessonModal(lesson);
  });

  document.getElementById('deleteCurrentLessonBtn').addEventListener('click', () => {
    if (state.currentLessonId) requestDeleteLesson(state.currentLessonId);
  });

  // Сворачивание / разворачивание блоков со скриптами
  setupScriptCollapseButton(
    'toggleTeacherScriptBtn',
    'teacherScriptWrapper',
    'toggleTeacherScriptText',
    'toggleTeacherScriptIcon'
  );
  setupScriptCollapseButton(
    'toggleStudentScriptBtn',
    'studentScriptWrapper',
    'toggleStudentScriptText',
    'toggleStudentScriptIcon'
  );

  // Кнопки добавления флеш-карточки со страницы урока
  document.getElementById('openAddCardBtn').addEventListener('click', () => openSingleCardModal(-1));
  document.getElementById('emptyAddCardBtn').addEventListener('click', () => openSingleCardModal(-1));

  // Встроенный редактор карточек внутри модального окна урока
  document.getElementById('inlineSaveCardBtn').addEventListener('click', handleInlineCardSave);
  document.getElementById('inlineCancelCardEditBtn').addEventListener('click', resetInlineCardEditor);

  // Предпросмотр картинки при вводе URL в отдельной модалке карточки
  document.getElementById('cardImageUrlInput').addEventListener('input', (e) => {
    updateCardImagePreview(e.target.value);
  });

  // Отправка форм урока и карточки
  document.getElementById('lessonForm').addEventListener('submit', handleLessonFormSubmit);
  document.getElementById('cardForm').addEventListener('submit', handleSingleCardFormSubmit);

  // Подтверждение удаления
  document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
    if (typeof state.confirmCallback === 'function') {
      state.confirmCallback();
    }
  });

  // Закрытие модальных окон
  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeModal(btn.getAttribute('data-close-modal'));
    });
  });

  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && !state.isSaving) {
        closeModal(overlay.id);
      }
    });
  });

  // Управление в режиме тренировки
  document.getElementById('exitTrainingBtn').addEventListener('click', () => {
    if (state.currentLessonId) {
      openLessonScreen(state.currentLessonId);
    } else {
      goHomeScreen();
    }
  });

  document.getElementById('trainingCardContainer').addEventListener('click', toggleTrainingFlip);
  document.getElementById('flipCardBtn').addEventListener('click', toggleTrainingFlip);
  document.getElementById('prevCardBtn').addEventListener('click', () => stepTrainingCard(-1));
  document.getElementById('nextCardBtn').addEventListener('click', () => stepTrainingCard(1));

  // Клавиатурная навигация (Пробел — переворот, Стрелки — вперёд/назад, Escape — выход)
  document.addEventListener('keydown', (e) => {
    const openModalEl = document.querySelector('.modal-overlay:not(.hidden)');
    if (openModalEl) {
      if (e.key === 'Escape' && !state.isSaving) {
        closeModal(openModalEl.id);
      }
      return;
    }

    const isTrainingActive = document.getElementById('screenTraining').classList.contains('active');
    if (!isTrainingActive) return;

    const activeTag = document.activeElement ? document.activeElement.tagName : '';
    if (e.code === 'Space' && activeTag !== 'INPUT' && activeTag !== 'TEXTAREA' && activeTag !== 'BUTTON') {
      e.preventDefault();
      toggleTrainingFlip();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      stepTrainingCard(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      stepTrainingCard(-1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (state.currentLessonId) openLessonScreen(state.currentLessonId);
    }
  });
}

// Запуск приложения после полной загрузки DOM
document.addEventListener('DOMContentLoaded', initApp);

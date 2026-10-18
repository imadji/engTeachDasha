/**
 * Глобальное состояние приложения: роль, тема, вкладки, токен учителя, тосты.
 * Реактивный стор на Vue ref/computed без внешних зависимостей.
 */
import { ref, computed } from 'vue';
import { ROLE_STORAGE_KEY, THEME_STORAGE_KEY, TEACHER_TOKEN_KEY } from '../config/api.js';

/* ---------- Тема оформления ---------- */

const savedTheme = (() => {
  try {
    const t = localStorage.getItem(THEME_STORAGE_KEY);
    return t === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
})();

const theme = ref(savedTheme);

function applyTheme(value) {
  document.documentElement.setAttribute('data-theme', value);
}

applyTheme(theme.value);

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
  applyTheme(theme.value);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme.value);
  } catch {
    /* приватный режим */
  }
}

/* ---------- Роль пользователя ---------- */

function readSavedRole() {
  try {
    const role = localStorage.getItem(ROLE_STORAGE_KEY);
    return role === 'student' || role === 'teacher' ? role : null;
  } catch {
    return null;
  }
}

const role = ref(readSavedRole());

function setRole(value) {
  role.value = value;
  try {
    if (value) localStorage.setItem(ROLE_STORAGE_KEY, value);
    else localStorage.removeItem(ROLE_STORAGE_KEY);
  } catch {
    /* приватный режим */
  }
}

const isTeacher = computed(() => role.value === 'teacher');

/* ---------- Активная вкладка главного экрана ---------- */

// 'lessons' | 'boards' | 'calls' — уроки по умолчанию на главной
const activeTab = ref('lessons');

function setTab(tab) {
  activeTab.value = tab;
}

/* ---------- Токен учителя ---------- */

const teacherToken = ref(null);
let tokenRestored = false;

function restoreTeacherToken() {
  if (tokenRestored) return;
  tokenRestored = true;
  try {
    teacherToken.value = localStorage.getItem(TEACHER_TOKEN_KEY) || sessionStorage.getItem(TEACHER_TOKEN_KEY) || null;
  } catch {
    teacherToken.value = null;
  }
}

function setTeacherToken(token, remember) {
  teacherToken.value = token || null;
  try {
    if (token && remember) localStorage.setItem(TEACHER_TOKEN_KEY, token);
    else localStorage.removeItem(TEACHER_TOKEN_KEY);
    if (token && !remember) sessionStorage.setItem(TEACHER_TOKEN_KEY, token);
    else sessionStorage.removeItem(TEACHER_TOKEN_KEY);
  } catch {
    /* приватный режим */
  }
}

function clearTeacherToken() {
  setTeacherToken(null, false);
}

/* ---------- Экраны вкладки «Уроки» ---------- */

// 'list' | 'lesson' | 'training'
const lessonsScreen = ref('list');
const currentLessonId = ref(null);

/* ---------- Экран вкладки «Доски» ---------- */

// 'list' | 'board'
const boardsScreen = ref('list');
const currentBoardId = ref(null);
const currentBoardKey = ref(null);

/* ---------- Видеозвонки ---------- */

const currentCallRoomId = ref(null);
const currentCallKey = ref(null);
// Откуда запущен звонок: { tab, lessonId, boardId, boardKey } для кнопки «Назад»
let callReturnContext = null;

function setCallContext(context) {
  callReturnContext = context;
}

function getCallContext() {
  return callReturnContext;
}

/* ---------- Модальные окна ---------- */

const authModalOpen = ref(false);
// Подсказка, зачем открыт запрос токена
const authModalHint = ref('');
// Колбэк после успешной авторизации
let authSuccessCallback = null;

function openAuthModal(hint = '', onSuccess = null) {
  authModalHint.value = hint;
  authSuccessCallback = onSuccess;
  authModalOpen.value = true;
}

function closeAuthModal() {
  authModalOpen.value = false;
  authSuccessCallback = null;
}

function resolveAuthSuccess() {
  const callback = authSuccessCallback;
  closeAuthModal();
  if (typeof callback === 'function') callback();
}

/* ---------- Тосты (уведомления) ---------- */

const toasts = ref([]);
let toastId = 0;

function toast(message, isError = false) {
  const id = ++toastId;
  toasts.value.push({ id, message, isError });
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, 3400);
}

/* ---------- Экспорт стора ---------- */

export function useAppStore() {
  return {
    theme,
    toggleTheme,
    role,
    setRole,
    isTeacher,
    activeTab,
    setTab,
    teacherToken,
    restoreTeacherToken,
    setTeacherToken,
    clearTeacherToken,
    lessonsScreen,
    currentLessonId,
    boardsScreen,
    currentBoardId,
    currentBoardKey,
    currentCallRoomId,
    currentCallKey,
    setCallContext,
    getCallContext,
    authModalOpen,
    authModalHint,
    openAuthModal,
    closeAuthModal,
    resolveAuthSuccess,
    toasts,
    toast
  };
}

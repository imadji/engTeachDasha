/**
 * Хранилище уроков: загрузка, создание, обновление, удаление уроков и карточек.
 * Вся работа с API уроков (Cloudflare KV) инкапсулирована здесь.
 */
import { ref } from 'vue';
import DOMPurify from 'dompurify';
import { LESSONS_API_URL } from '../config/api.js';
import { useAppStore } from './appStore.js';

const lessons = ref([]);
const isLoading = ref(false);
const isSaving = ref(false);

const { toast } = useAppStore();

// Заглушка на случай битой ссылки на картинку (SVG Data URI)
const FALLBACK_IMAGE_URI =
  'data:image/svg+xml;charset=UTF-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="450" viewBox="0 0 600 450">
      <rect width="600" height="450" fill="#eef3f8"/>
      <g fill="none" stroke="#9bb2c9" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" transform="translate(240, 155)">
        <rect x="0" y="0" width="120" height="95" rx="14" fill="#ffffff"/>
        <circle cx="38" cy="34" r="10"/>
        <path d="M8 82 L45 48 L75 74 L95 56 L112 82"/>
      </g>
      <text x="300" y="295" text-anchor="middle" font-family="Nunito, sans-serif" font-size="18" font-weight="700" fill="#6486ac">Изображение недоступно</text>
      <text x="300" y="320" text-anchor="middle" font-family="Inter, sans-serif" font-size="13" fill="#8e94a0">Проверьте ссылку на картинку (URL)</text>
    </svg>`
  );

/**
 * Нормализация урока, полученного с сервера (совместимость старых полей)
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
    teacherScript:
      typeof raw.teacherScript === 'string'
        ? raw.teacherScript
        : typeof raw.script === 'string'
          ? raw.script
          : '',
    studentScript: typeof raw.studentScript === 'string' ? raw.studentScript : '',
    published: raw.published === true,
    cards,
    createdAt: raw.createdAt || new Date().toISOString()
  };
}

/**
 * GET /lessons — загрузка всех уроков из облака
 */
async function fetchLessons() {
  isLoading.value = true;
  try {
    const response = await fetch(`${LESSONS_API_URL}/lessons`, {
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const rawList = Array.isArray(data) ? data : Array.isArray(data?.lessons) ? data.lessons : [];
    lessons.value = rawList
      .map(normalizeLesson)
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch (error) {
    console.error('Ошибка загрузки уроков:', error);
    toast('Не удалось загрузить уроки. Проверьте соединение.', true);
  } finally {
    isLoading.value = false;
  }
}

/**
 * POST /lessons — создание или обновление урока
 */
async function saveLesson(payload) {
  isSaving.value = true;
  try {
    const body = {
      ...(payload.id ? { id: payload.id } : {}),
      title: payload.title,
      teacherScript: payload.teacherScript || '',
      studentScript: payload.studentScript || '',
      published: Boolean(payload.published),
      cards: payload.cards || [],
      createdAt: payload.createdAt || new Date().toISOString()
    };
    const response = await fetch(`${LESSONS_API_URL}/lessons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`Ошибка сохранения (${response.status})`);
    const result = await response.json();
    if (result.success === false || !(result.id || body.id)) throw new Error('Сервер не подтвердил сохранение');
    const saved = normalizeLesson({ ...body, id: result.id || body.id });

    const index = lessons.value.findIndex((l) => l.id === saved.id);
    if (index !== -1) lessons.value[index] = saved;
    else lessons.value.unshift(saved);

    toast(payload.id ? 'Урок обновлён' : 'Урок создан');
    return saved;
  } catch (error) {
    console.error('Ошибка POST /lessons:', error);
    toast('Не удалось сохранить урок на сервере', true);
    return null;
  } finally {
    isSaving.value = false;
  }
}

/**
 * DELETE /lessons/:id — удаление урока
 */
async function deleteLesson(lessonId) {
  isSaving.value = true;
  try {
    const response = await fetch(`${LESSONS_API_URL}/lessons/${encodeURIComponent(lessonId)}`, {
      method: 'DELETE'
    });
    if (!response.ok) throw new Error(`Ошибка удаления (${response.status})`);
    lessons.value = lessons.value.filter((l) => l.id !== lessonId);
    toast('Урок удалён');
    return true;
  } catch (error) {
    console.error('Ошибка DELETE /lessons:', error);
    toast('Не удалось удалить урок', true);
    return false;
  } finally {
    isSaving.value = false;
  }
}

/**
 * Утилиты для карточек урока: перемещение, удаление, добавление
 */
function getLessonById(lessonId) {
  return lessons.value.find((l) => l.id === lessonId) || null;
}

async function updateLessonCards(lessonId, cards) {
  const lesson = getLessonById(lessonId);
  if (!lesson) return false;
  const saved = await saveLesson({ ...lesson, cards });
  return Boolean(saved);
}

/**
 * Форматирование даты на русском
 */
function formatDate(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
}

/**
 * Склонение количества карточек: 1 карточка / 2 карточки / 5 карточек
 */
function pluralizeCards(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} карточка`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${count} карточки`;
  return `${count} карточек`;
}

/**
 * Проверка корректности URL изображения
 */
function isValidUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Рендеринг Markdown через marked с очисткой опасных тегов
 */
import { marked } from 'marked';

marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(source) {
  const text = typeof source === 'string' ? source.trim() : '';
  if (!text) return '';
  const html = marked.parse(text);
  return DOMPurify.sanitize(html);
}

export function useLessonsStore() {
  return {
    lessons,
    isLoading,
    isSaving,
    fetchLessons,
    saveLesson,
    deleteLesson,
    getLessonById,
    updateLessonCards,
    formatDate,
    pluralizeCards,
    isValidUrl,
    renderMarkdown,
    FALLBACK_IMAGE_URI
  };
}

/**
 * Конфигурация API.
 * lessonsApi — существующий Worker с уроками (KV).
 * collabApi  — Worker совместной работы: доски (Durable Objects) и видеозвонки (RealtimeKit).
 */
export const LESSONS_API_URL = 'https://flashcards-api.vip-obzor.workers.dev';

export const COLLAB_API_URL = 'https://flashcards-collaboration.vip-obzor.workers.dev';

// Ключи localStorage / sessionStorage
export const ROLE_STORAGE_KEY = 'englishFlashcardsUserRole';
export const THEME_STORAGE_KEY = 'englishFlashcardsTheme';
export const TEACHER_TOKEN_KEY = 'englishFlashcardsTeacherToken';

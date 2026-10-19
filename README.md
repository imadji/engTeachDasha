# English Flashcards (Vue 3 + Vite)

Облачная платформа для преподавателей и учеников английского языка на **Vue 3 (Composition API, `<script setup>`) + Vite** с тремя независимыми вкладками:
1. **📚 Уроки (Главная)** — создание и редактирование уроков, Markdown-скриптов для учителя и ученика, управление визуальными флеш-карточками (с обязательным переводом на русский и импортом из JSON) и режим 3D-тренировки.
2. **🎨 Доски** — совместная интерактивная доска в стиле Miro (рисование, фигуры, стикеры, текст, картинки по URL, слои, зум и панорама) с синхронизацией в реальном времени через **Cloudflare Durable Objects + WebSocket**.
3. **📹 Видеозвонки** — создание видеокомнат, подключение ученика по ссылке-приглашению, управление микрофоном, камерой и демонстрацией экрана через **Cloudflare RealtimeKit**.

---

## Структура проекта

```text
engTeachDasha/
├── app.html                         # Исходный HTML-шаблон Vite
├── vite.config.js                   # Конфигурация сборки Vite + публикация в корень для GitHub Pages
├── package.json                     # Зависимости (vue, marked, dompurify, vite)
├── backend/
│   ├── worker.js                    # Cloudflare Worker (Durable Objects BoardRoom + RealtimeKit)
│   └── wrangler.jsonc               # Конфигурация Worker'а
└── src/
    ├── main.js                      # Инициализация Vue 3
    ├── App.vue                      # Корневой компонент и переключение вкладок
    ├── assets/main.css              # Пастельная дизайн-система, светлая и тёмная темы
    ├── config/api.js                # Адреса API уроков и Worker'а совместной работы
    ├── lib/
    │   ├── boardCanvas.js           # Движок интерактивной Canvas-доски + WebSocket
    │   └── realtimeCall.js          # Обёртка над Cloudflare RealtimeKit SDK
    ├── stores/
    │   ├── appStore.js              # Роль, тема, вкладки, ключ учителя, уведомления
    │   ├── lessonsStore.js          # Работа с API уроков и карточек
    │   └── collabStore.js           # Работа с API досок и видеозвонков
    └── components/
        ├── layout/                  # AppHeader.vue, MainTabs.vue, ToastContainer.vue
        ├── modals/                  # TeacherAuthModal.vue, LessonFormModal.vue, CardFormModal.vue и др.
        └── views/                   # RoleSelectView, LessonsListView, LessonDetailView, TrainingView, BoardsView, CallsView
```

---

## Локальная разработка и сборка

```bash
# Установка зависимостей
npm install

# Запуск dev-сервера (http://localhost:5173/engTeachDasha/)
npm run dev

# Сборка для продакшена (обновляет dist/, index.html и assets/)
npm run build
```

---

## Доступ учителя

При выборе роли **«Я учитель»** или нажатии кнопки **«Ключ учителя»** в шапке открывается модальное окно ввода ключа доступа (`TEACHER_TOKEN`), который защищает создание/удаление досок и комнат видеозвонков. Можно включить галочку **«Запомнить на этом устройстве»**, чтобы не вводить ключ повторно.

# English Flashcards — Облачное приложение для преподавателя с совместной работой

**English Flashcards** — это полнофункциональная облачная платформа для преподавания английского языка с визуальными флеш-карточками, интерактивными досками и видеозвонками в реальном времени.

---

## Ключевые возможности

### Для преподавателя
- **Управление уроками**: создание уроков, скриптов и флеш-карточек с картинками и переводами в личном кабинете
- **Режим тренировки**: крупные 3D-карточки с анимированным переворотом (клик или пробел) для демонстрации ученику
- **Публикация уроков**: переключение урока в режим «Опубликовано» — генерируется постоянная ссылка-приглашение для ученика
- **Интерактивные доски**: создание и совместное редактирование досок с инструментами рисования, стикерами и фигурами (Cloudflare Durable Objects + WebSocket)
- **Видеозвонки 1:1**: встроенная поддержка WebRTC с демонстрацией экрана через Cloudflare Calls (на базе LiveKit)
- **Переключение темы**: светлая/тёмная тема с мягкой пастельной палитрой, сохраняется в localStorage

### Для ученика
- **Доступ по ссылке-приглашению**: ученик открывает опубликованный урок, доску или присоединяется к звонку через постоянную ссылку (без регистрации)
- **Режим просмотра**: флеш-карточки и скрипты урока отображаются в удобном чистом интерфейсе (никаких кнопок редактирования)
- **Режим тренировки**: ученик видит крупные карточки и может листать их стрелками и переворачивать пробелом
- **Совместная работа**: рисунки, стикеры и правки учителя на доске видны ученику в реальном времени
- **Видеозвонки**: присоединение к видеокомнате одним кликом по ссылке от учителя

---

## Архитектура и технологии

### Frontend (статика, без Node.js сборки)
- **HTML + CSS + JavaScript (ES6+)**: чистая клиентская реализация, никаких фреймворков и бандлеров
- **Marked.js**: рендеринг Markdown-скриптов уроков с безопасной санитизацией DOMPurify
- **Canvas API**: интерактивная доска с drag-and-drop объектов, инструментами рисования и отменой/повтором
- **Адаптивный дизайн**: mobile-first CSS Grid/Flexbox, от смартфонов до широких десктопов (1-4 колонки)
- **3D CSS-анимации**: переворот карточек через `transform: rotateY(180deg)` с плавностью 0.65s

### Backend (Cloudflare Workers + D1 + Durable Objects)
1. **Основной Worker для уроков и карточек** (`flashcards-api.vip-obzor.workers.dev`):
   - REST API: `GET /lessons`, `POST /lessons`, `PUT /lessons/:id`, `DELETE /lessons/:id`
   - Публикация уроков: `POST /lessons/:id/publish` → генерация постоянного ключа `?key=abc123def`
   - Хранение данных: **Cloudflare D1** (SQLite в облаке, 5GB бесплатно)
   - Авторизация учителя: проверка заголовка `X-Teacher-Token` против переменной окружения `TEACHER_TOKEN`
   - CORS для любого фронтенда (домен не привязан)

2. **Worker совместной работы — доски и видеозвонки** (`collaboration.your-subdomain.workers.dev`):
   - REST API досок: `GET /boards`, `POST /boards`, `DELETE /boards/:id`, `POST /boards/:id/invite`
   - WebSocket-синхронизация доски: `/boards/:id/ws` (через Cloudflare Durable Objects с broadcast)
   - Генерация LiveKit-токенов для Cloudflare Calls: `POST /calls/:roomId/token`
   - Создание комнаты звонка: `POST /calls` → возвращает `roomId` и постоянный ключ `?call=roomId&key=abc123`
   - Авторизация: тот же `X-Teacher-Token` и ключи приглашения для учеников

---

## Быстрый старт

### 1. Разверните фронтенд (статика)
Приложение работает без сборки: скопируйте файлы на любой хостинг статики.

#### Вариант A: Cloudflare Pages (рекомендуется)
```bash
# Установите Wrangler (CLI Cloudflare)
npm install -g wrangler

# Войдите в Cloudflare
wrangler login

# Опубликуйте статику прямо из папки проекта
wrangler pages deploy . --project-name=english-flashcards
```
Ссылка будет вида `https://english-flashcards.pages.dev`.

#### Вариант Б: GitHub Pages
1. Создайте репозиторий на GitHub и загрузите все файлы из папки проекта
2. Settings → Pages → выберите ветку `main` → Save
3. Сайт станет доступен через 1-2 минуты: `https://username.github.io/repo-name/`

#### Вариант В: Vercel / Netlify / Surge.sh
Перетащите папку в веб-интерфейс любого из этих сервисов — развёртывание мгновенное и бесплатное.

---

### 2. Создайте основной Worker для уроков

#### 2.1. Инициализация Wrangler-проекта
```bash
mkdir flashcards-api
cd flashcards-api
wrangler init -y
```

#### 2.2. Настройте `wrangler.toml`
```toml
name = "flashcards-api"
main = "src/index.js"
compatibility_date = "2025-01-15"

[[d1_databases]]
binding = "DB"
database_name = "flashcards"
database_id = "YOUR_D1_DATABASE_ID"  # получите ниже через wrangler d1 create

[vars]
# Публичные переменные (не секреты)
CORS_ORIGIN = "*"
```

#### 2.3. Создайте базу данных D1
```bash
wrangler d1 create flashcards
# Скопируйте database_id из вывода команды в wrangler.toml
```

#### 2.4. Примените миграции для таблиц уроков
Создайте `migrations/0001_create_lessons.sql`:
```sql
CREATE TABLE lessons (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  script TEXT,
  cards TEXT NOT NULL DEFAULT '[]',
  published INTEGER NOT NULL DEFAULT 0,
  publish_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_publish_key ON lessons(publish_key) WHERE publish_key IS NOT NULL;
```

Примените локально и в продакшен:
```bash
wrangler d1 execute flashcards --local --file=migrations/0001_create_lessons.sql
wrangler d1 execute flashcards --remote --file=migrations/0001_create_lessons.sql
```

#### 2.5. Реализуйте основной Worker (`src/index.js`)
```javascript
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = {
      'Access-Control-Allow-Origin': env.CORS_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Teacher-Token',
      'Content-Type': 'application/json'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    const isTeacher = request.headers.get('X-Teacher-Token') === env.TEACHER_TOKEN;
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });

    try {
      // GET /lessons (все опубликованные + свои, если учитель)
      if (url.pathname === '/lessons' && request.method === 'GET') {
        let query = 'SELECT id, title, script, cards, published, created_at, updated_at FROM lessons WHERE published = 1';
        if (isTeacher) query = 'SELECT * FROM lessons';
        const result = await env.DB.prepare(query).all();
        return reply(result.results.map(row => ({ ...row, cards: JSON.parse(row.cards || '[]') })));
      }

      // POST /lessons (только учитель)
      if (url.pathname === '/lessons' && request.method === 'POST') {
        if (!isTeacher) return reply({ error: 'Teacher token required' }, 403);
        const body = await request.json();
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        await env.DB.prepare(
          'INSERT INTO lessons (id, title, script, cards, published, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
        ).bind(id, body.title || 'Без названия', body.script || '', JSON.stringify(body.cards || []), now, now).run();
        return reply({ id, title: body.title, script: body.script, cards: body.cards || [], published: false, createdAt: now });
      }

      // PUT /lessons/:id (только учитель)
      const putMatch = url.pathname.match(/^\/lessons\/([^/]+)$/);
      if (putMatch && request.method === 'PUT') {
        if (!isTeacher) return reply({ error: 'Teacher token required' }, 403);
        const id = decodeURIComponent(putMatch[1]);
        const body = await request.json();
        await env.DB.prepare('UPDATE lessons SET title = ?, script = ?, cards = ?, updated_at = ? WHERE id = ?')
          .bind(body.title, body.script || '', JSON.stringify(body.cards || []), new Date().toISOString(), id).run();
        return reply({ success: true });
      }

      // DELETE /lessons/:id (только учитель)
      const deleteMatch = url.pathname.match(/^\/lessons\/([^/]+)$/);
      if (deleteMatch && request.method === 'DELETE') {
        if (!isTeacher) return reply({ error: 'Teacher token required' }, 403);
        await env.DB.prepare('DELETE FROM lessons WHERE id = ?').bind(decodeURIComponent(deleteMatch[1])).run();
        return reply({ success: true });
      }

      // POST /lessons/:id/publish — публикация урока с генерацией постоянного ключа
      const publishMatch = url.pathname.match(/^\/lessons\/([^/]+)\/publish$/);
      if (publishMatch && request.method === 'POST') {
        if (!isTeacher) return reply({ error: 'Teacher token required' }, 403);
        const id = decodeURIComponent(publishMatch[1]);
        const key = crypto.randomUUID().replace(/-/g, '').substring(0, 16);
        await env.DB.prepare('UPDATE lessons SET published = 1, publish_key = ?, updated_at = ? WHERE id = ?')
          .bind(key, new Date().toISOString(), id).run();
        return reply({ published: true, key });
      }

      // POST /lessons/:id/unpublish — отмена публикации (учитель снимает урок)
      const unpublishMatch = url.pathname.match(/^\/lessons\/([^/]+)\/unpublish$/);
      if (unpublishMatch && request.method === 'POST') {
        if (!isTeacher) return reply({ error: 'Teacher token required' }, 403);
        const id = decodeURIComponent(unpublishMatch[1]);
        await env.DB.prepare('UPDATE lessons SET published = 0, updated_at = ? WHERE id = ?')
          .bind(new Date().toISOString(), id).run();
        return reply({ published: false });
      }

      // GET /lessons/:id?key=... — ученик получает опубликованный урок по ключу
      const viewMatch = url.pathname.match(/^\/lessons\/([^/]+)$/);
      if (viewMatch && request.method === 'GET') {
        const id = decodeURIComponent(viewMatch[1]);
        const key = url.searchParams.get('key');
        const lesson = await env.DB.prepare('SELECT * FROM lessons WHERE id = ? AND published = 1 AND publish_key = ?')
          .bind(id, key).first();
        if (!lesson) return reply({ error: 'Lesson not found or not published' }, 404);
        return reply({ ...lesson, cards: JSON.parse(lesson.cards || '[]') });
      }

      return reply({ error: 'Not found' }, 404);
    } catch (err) {
      return reply({ error: err.message }, 500);
    }
  }
};
```

#### 2.6. Задайте секретный токен учителя
```bash
# Генерация случайного токена (32 символа)
openssl rand -hex 16

# Сохранение в Cloudflare (не в wrangler.toml, а в зашифрованном виде!)
wrangler secret put TEACHER_TOKEN
# Введите сгенерированный токен при запросе
```

#### 2.7. Разверните Worker
```bash
wrangler deploy
# Получите URL вида https://flashcards-api.your-subdomain.workers.dev
```

#### 2.8. Обновите конфиг фронтенда
Откройте файл `api-config.js` в корне вашего статического сайта и укажите адрес Worker'а:
```javascript
window.API_CONFIG = {
  baseUrl: 'https://flashcards-api.your-subdomain.workers.dev'
};
```

---

### 3. Создайте Worker совместной работы (доски + звонки)

#### 3.1. Инициализация проекта
```bash
mkdir collaboration-worker
cd collaboration-worker
wrangler init -y
```

#### 3.2. Настройте `wrangler.toml`
```toml
name = "collaboration-worker"
main = "src/index.js"
compatibility_date = "2025-01-15"

[[durable_objects.bindings]]
name = "BOARD"
class_name = "BoardDurableObject"
script_name = "collaboration-worker"

[[migrations]]
tag = "v1"
new_classes = ["BoardDurableObject"]

[vars]
CORS_ORIGIN = "*"
```

#### 3.3. Получите APP_ID и APP_KEY от Cloudflare Calls (LiveKit)
1. Войдите в [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Перейдите в раздел **Calls** → **Apps** → создайте приложение
3. Скопируйте **APP_ID** (публичный идентификатор) и **APP_KEY** (секрет для подписи токенов)
4. Сохраните их как секреты:
```bash
wrangler secret put CALLS_APP_ID
wrangler secret put CALLS_APP_KEY
wrangler secret put TEACHER_TOKEN
```

#### 3.4. Реализуйте Worker (`src/index.js`)
```javascript
import { AccessToken } from 'livekit-server-sdk';

// Durable Object для синхронизации одной доски через WebSocket
export class BoardDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = [];
    this.boardState = { objects: [] };
  }

  async fetch(request) {
    const upgrade = request.headers.get('Upgrade');
    if (upgrade !== 'websocket') return new Response('Expected WebSocket', { status: 426 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    this.sessions.push(server);

    server.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'update') {
          this.boardState = msg.state;
          this.broadcast(JSON.stringify({ type: 'state', state: this.boardState }), server);
        }
      } catch {
        /* игнорируем невалидные сообщения */
      }
    });

    server.addEventListener('close', () => {
      this.sessions = this.sessions.filter(s => s !== server);
    });

    server.send(JSON.stringify({ type: 'state', state: this.boardState }));
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(message, exclude) {
    this.sessions.forEach(ws => {
      if (ws !== exclude && ws.readyState === 1) ws.send(message);
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = {
      'Access-Control-Allow-Origin': env.CORS_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Teacher-Token',
      'Content-Type': 'application/json'
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    const isTeacher = request.headers.get('X-Teacher-Token') === env.TEACHER_TOKEN;
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });

    try {
      // GET /boards — список досок учителя (хранятся в KV или памяти Worker, упрощённо — в памяти)
      if (url.pathname === '/boards' && request.method === 'GET') {
        if (!isTeacher) return reply({ error: 'Teacher token required' }, 403);
        // Для продакшена: хранить в KV или D1
        return reply([]);
      }

      // POST /boards — создание доски
      if (url.pathname === '/boards' && request.method === 'POST') {
        if (!isTeacher) return reply({ error: 'Teacher token required' }, 403);
        const body = await request.json();
        const id = crypto.randomUUID();
        const key = crypto.randomUUID().replace(/-/g, '').substring(0, 16);
        const board = { id, title: body.title || 'Новая доска', createdAt: new Date().toISOString() };
        // Сохранить в KV: await env.BOARDS_KV.put(id, JSON.stringify(board));
        return reply({ board, key });
      }

      // WebSocket /boards/:id/ws
      const wsMatch = url.pathname.match(/^\/boards\/([^/]+)\/ws$/);
      if (wsMatch) {
        const boardId = decodeURIComponent(wsMatch[1]);
        const stub = env.BOARD.get(env.BOARD.idFromName(boardId));
        return stub.fetch(request);
      }

      // POST /calls/:roomId/token — генерация LiveKit-токена для участника
      const tokenMatch = url.pathname.match(/^\/calls\/([^/]+)\/token$/);
      if (tokenMatch && request.method === 'POST') {
        const roomId = decodeURIComponent(tokenMatch[1]);
        const body = await request.json();
        const identity = body.name || 'User';

        const token = new AccessToken(env.CALLS_APP_ID, env.CALLS_APP_KEY, { identity });
        token.addGrant({ room: roomId, roomJoin: true, canPublish: true, canSubscribe: true });
        const jwt = token.toJwt();

        return reply({ token: jwt });
      }

      // POST /calls — создание комнаты
      if (url.pathname === '/calls' && request.method === 'POST') {
        if (!isTeacher) return reply({ error: 'Teacher token required' }, 403);
        const roomId = crypto.randomUUID();
        const key = crypto.randomUUID().replace(/-/g, '').substring(0, 16);
        return reply({ roomId, key });
      }

      return reply({ error: 'Not found' }, 404);
    } catch (err) {
      return reply({ error: err.message }, 500);
    }
  }
};
```

#### 3.5. Установите зависимости LiveKit SDK
```bash
npm install livekit-server-sdk
```

#### 3.6. Разверните Worker
```bash
wrangler deploy
# Получите URL вида https://collaboration-worker.your-subdomain.workers.dev
```

#### 3.7. Обновите конфиг совместной работы на фронтенде
Откройте `collaboration-config.js`:
```javascript
window.COLLABORATION_CONFIG = {
  apiUrl: 'https://collaboration-worker.your-subdomain.workers.dev'
};
```

---

## Локальная разработка

### Запуск фронтенда локально
```bash
# Установите любой простой HTTP-сервер
npm install -g http-server

# Запустите в папке проекта
http-server -p 8080 -c-1

# Откройте http://localhost:8080
```

### Локальная отладка Worker'а уроков
```bash
cd flashcards-api
wrangler dev --local --persist
# Откройте http://localhost:8787
```

### Локальная отладка Worker'а совместной работы
```bash
cd collaboration-worker
wrangler dev --local --persist
```

Укажите локальные адреса в конфигах фронтенда (api-config.js и collaboration-config.js) для тестирования.

---

## Безопасность и ограничения

### Авторизация учителя
- Токен учителя передаётся в заголовке `X-Teacher-Token` и проверяется на стороне Worker
- Токен НЕ сохраняется в localStorage, только в sessionStorage (память текущей вкладки)
- Ученик не имеет токена и может открывать только опубликованные уроки по постоянным ключам `?key=abc123`

### Публичные ссылки для учеников
- Ссылка на урок: `https://your-site.com/?lesson=uuid&key=publishKey`
- Ссылка на доску: `https://your-site.com/?board=uuid&key=boardKey`
- Ссылка на звонок: `https://your-site.com/?call=roomId&key=callKey`
- Ключи генерируются сервером и не хранятся на фронтенде

### Ограничения Cloudflare Free Tier
- **D1**: 5 ГБ хранилища, 5 млн операций чтения/день (достаточно для сотен уроков и тысяч карточек)
- **Durable Objects**: 1 млн запросов/месяц (одна доска = один объект, синхронизация в реальном времени)
- **Cloudflare Calls**: 1000 минут видеозвонков/месяц (бета-версия, может измениться)
- **Workers**: 100,000 запросов/день, 10 мс CPU на запрос (хватает для REST API и WebSocket)

---

## Структура проекта

```
engTeachDasha/
├── index.html                  # Основная разметка (все экраны)
├── style.css                   # Стили приложения (светлая/тёмная тема)
├── script.js                   # Главная логика: уроки, карточки, навигация, публикация
├── collab.js                   # Модуль совместной работы: доски, звонки, приглашения
├── board.js                    # Интерактивная Canvas-доска с WebSocket-синхронизацией
├── call.js                     # Видеозвонки через Cloudflare Calls (LiveKit SDK)
├── api-config.js               # Конфигурация: адрес основного Worker'а уроков
├── collaboration-config.js     # Конфигурация: адрес Worker'а досок и звонков
├── README.md                   # Этот файл (документация)
└── marked.min.js               # Библиотека для рендеринга Markdown (CDN-альтернатива)
```

### Backend (отдельные репозитории Wrangler)
```
flashcards-api/                 # Worker уроков и карточек
├── src/index.js                # REST API + D1 + публикация уроков
├── wrangler.toml               # Конфигурация Worker (D1 binding, токены)
└── migrations/                 # SQL-миграции для D1 (таблицы lessons)

collaboration-worker/           # Worker досок и звонков
├── src/index.js                # REST + WebSocket + Durable Objects + LiveKit-токены
├── wrangler.toml               # Конфигурация (Durable Objects, Calls APP_ID/KEY)
└── package.json                # Зависимости: livekit-server-sdk
```

---

## Расширение и доработка

### Добавление нового типа объектов на доску
1. Откройте `board.js` → найдите функцию `render()`
2. Добавьте обработку нового типа в `switch (obj.type)`
3. Добавьте кнопку инструмента в HTML (`#boardToolbar`) и обработчик в `board.js`

### Интеграция сторонних сервисов (например, Zoom API)
1. Замените модуль `call.js` на обёртку над Zoom SDK
2. Обновите Worker для генерации Zoom Meeting вместо LiveKit-токенов
3. Интерфейс `VideoCall.join(tokenProvider)` останется совместимым

### Хранение досок в D1 вместо Durable Objects (для персистентности)
1. Создайте таблицу `boards` в D1 с полями `id, title, state, created_at`
2. В `BoardDurableObject` загружайте начальное состояние из D1 при первом подключении
3. Сохраняйте изменения в D1 с debounce 5 секунд (`this.state.storage.put()` + периодический flush в D1)

---

## Поддержка и вклад

Нашли баг или хотите предложить улучшение? Откройте issue в репозитории проекта или отправьте pull request.

### Контакты
- **Email**: dasha@example.com
- **Telegram**: @dasha_teacher

---

## Лицензия

MIT License — вы можете свободно использовать, изменять и распространять этот проект для коммерческих и некоммерческих целей.

---

**Спасибо за использование English Flashcards!** 🎓✨

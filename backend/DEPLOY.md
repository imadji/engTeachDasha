# Деплой облачного бэкенда — пошаговая инструкция

Эта инструкция описывает развёртывание двух Cloudflare Workers для приложения **English Flashcards**:
1. **Worker уроков** — хранит уроки, карточки и скрипты в Cloudflare D1 (SQLite)
2. **Worker совместной работы** — синхронизирует доски через WebSocket (Durable Objects) и выдаёт токены для видеозвонков (Cloudflare Calls)

---

## Предварительные требования

1. **Аккаунт Cloudflare** (бесплатный): [https://dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)
2. **Node.js 18+**: [https://nodejs.org/](https://nodejs.org/)
3. **Wrangler CLI** (инструмент командной строки Cloudflare):
   ```bash
   npm install -g wrangler
   wrangler login
   ```

---

## Часть 1: Worker уроков и карточек

### Шаг 1. Клонируйте папку `backend` из проекта
```bash
cd backend
```

### Шаг 2. Создайте базу данных D1
```bash
wrangler d1 create flashcards-db
```
Скопируйте `database_id` из вывода команды.

### Шаг 3. Обновите `wrangler.jsonc`
Откройте файл `wrangler.jsonc` и вставьте `database_id`:
```jsonc
{
  "name": "flashcards-api",
  "main": "worker.js",
  "compatibility_date": "2025-01-15",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "flashcards-db",
      "database_id": "ВАШ_DATABASE_ID_СЮДА"
    }
  ]
}
```

### Шаг 4. Примените SQL-миграции
Создайте файл `migrations/001_init.sql`:
```sql
CREATE TABLE lessons (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  script TEXT,
  student_script TEXT,
  cards TEXT NOT NULL DEFAULT '[]',
  published INTEGER DEFAULT 0,
  publish_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_publish_key ON lessons(publish_key) WHERE publish_key IS NOT NULL;
```

Примените локально и в продакшен:
```bash
wrangler d1 execute flashcards-db --local --file=migrations/001_init.sql
wrangler d1 execute flashcards-db --remote --file=migrations/001_init.sql
```

### Шаг 5. Задайте токен учителя
```bash
# Генерация случайного токена (сохраните его!)
openssl rand -hex 16

# Запись токена в секреты Cloudflare (не в wrangler.jsonc!)
wrangler secret put TEACHER_TOKEN
# Введите сгенерированный токен при запросе
```

### Шаг 6. Разверните Worker
```bash
wrangler deploy
```
Скопируйте URL из вывода, например: `https://flashcards-api.vip-obzor.workers.dev`

### Шаг 7. Обновите конфиг фронтенда
Откройте файл `script.js` в корне проекта и замените строку:
```javascript
const API_BASE_URL = 'https://flashcards-api.vip-obzor.workers.dev';
```
на ваш реальный URL Worker'а.

---

## Часть 2: Worker совместной работы (доски + звонки)

### Шаг 1. Настройте Cloudflare Calls (RealtimeKit)
1. Перейдите в [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Calls** (в меню слева)
2. Нажмите **Create Application**
3. Скопируйте:
   - **App ID** (например, `abc123def456`)
   - **API Token** (секретный ключ для подписи токенов)
4. Создайте два preset'а (роли участников):
   - Preset `host` (учитель): все разрешения (publish, subscribe, screen share)
   - Preset `student` (ученик): только subscribe + publish audio/video

### Шаг 2. Создайте отдельный Worker
Файл `backend/worker.js` уже готов (из проекта). Проверьте `wrangler.jsonc`:
```jsonc
{
  "name": "flashcards-collaboration",
  "main": "worker.js",
  "compatibility_date": "2025-01-15",
  "durable_objects": {
    "bindings": [{ "name": "BOARDS", "class_name": "BoardRoom" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["BoardRoom"] }],
  "vars": {
    "ALLOWED_ORIGINS": "http://localhost:8080,https://your-site.pages.dev",
    "CLOUDFLARE_ACCOUNT_ID": "ВАШ_ACCOUNT_ID",
    "REALTIMEKIT_APP_ID": "abc123def456",
    "REALTIMEKIT_HOST_PRESET": "host",
    "REALTIMEKIT_STUDENT_PRESET": "student"
  }
}
```

**Где взять Account ID**:
```bash
wrangler whoami
# Account ID будет в выводе: Copy и вставьте в CLOUDFLARE_ACCOUNT_ID
```

### Шаг 3. Задайте секреты
```bash
wrangler secret put TEACHER_TOKEN
# Введите тот же токен, что и для Worker'а уроков

wrangler secret put REALTIMEKIT_API_TOKEN
# Введите API Token из Cloudflare Calls (скопирован на шаге 1)
```

### Шаг 4. Разверните Worker
```bash
wrangler deploy
```
Скопируйте URL, например: `https://flashcards-collaboration.your-subdomain.workers.dev`

### Шаг 5. Обновите конфиг совместной работы
Откройте `collaboration-config.js` в корне фронтенда:
```javascript
window.COLLABORATION_CONFIG = {
  apiUrl: 'https://flashcards-collaboration.your-subdomain.workers.dev'
};
```

---

## Проверка работы

### 1. Откройте фронтенд
```bash
# Если ещё не развёрнут на Cloudflare Pages / GitHub Pages, запустите локально:
npx http-server -p 8080
```

### 2. Выберите роль «Я учитель»
При первом запросе к Worker'у (например, загрузка списка уроков) браузер попросит ввести токен учителя — вставьте сгенерированный на шаге 1.5.

### 3. Создайте тестовый урок
- Нажмите «Создать урок»
- Добавьте карточки с картинками
- Нажмите «Сохранить в облаке»
- Затем «Опубликовать урок» → скопируйте ссылку-приглашение

### 4. Откройте ссылку в режиме инкогнито (как ученик)
Браузер автоматически загрузит урок по ключу `?lesson=uuid&key=abc123` без запроса токена.

### 5. Создайте интерактивную доску
- Переключитесь на вкладку «Доски»
- Нажмите «Создать доску»
- Откройте доску → порисуйте инструментами
- Нажмите «Поделиться доской» → скопируйте ссылку
- Откройте в другой вкладке (как ученик) — рисунки синхронизируются в реальном времени

### 6. Запустите видеозвонок
- На открытой доске нажмите «Видеозвонок»
- Введите имя и нажмите «Присоединиться»
- Включите микрофон и камеру кнопками внизу экрана
- Отправьте ссылку-приглашение ученику — он присоединится одним кликом

---

## Устранение неполадок

### Ошибка «Worker not found» при деплое
```bash
# Убедитесь, что вы авторизованы:
wrangler whoami

# Если нет — войдите снова:
wrangler login
```

### Ошибка «Database not found» при миграциях
Проверьте, что `database_id` в `wrangler.jsonc` совпадает с выводом `wrangler d1 create`.

### Ошибка 403 «Teacher token required»
- Токен передаётся только с учётной записи учителя
- Для ученика используйте ссылки с `?key=...` — они не требуют токена

### Доска не синхронизируется (рисунки не появляются у второго участника)
1. Проверьте консоль браузера (F12) — должно быть `WebSocket opened`
2. Убедитесь, что `ALLOWED_ORIGINS` в `wrangler.jsonc` включает ваш домен фронтенда
3. Если используете локальную разработку: `http://localhost:8080` должен быть в `ALLOWED_ORIGINS`

### Видеозвонок не подключается
1. Проверьте, что `REALTIMEKIT_APP_ID` и `REALTIMEKIT_API_TOKEN` заданы корректно
2. Убедитесь, что preset'ы `host` и `student` существуют в настройках Cloudflare Calls
3. Откройте консоль браузера — ошибки RealtimeKit SDK появятся там

---

## Локальная отладка (без деплоя)

### Worker уроков локально
```bash
cd backend
wrangler dev --local --persist
# Worker доступен на http://localhost:8787
```

Обновите `script.js`:
```javascript
const API_BASE_URL = 'http://localhost:8787';
```

### Worker совместной работы локально
```bash
cd backend
wrangler dev --local --persist --port 8788
```

Обновите `collaboration-config.js`:
```javascript
window.COLLABORATION_CONFIG = { apiUrl: 'http://localhost:8788' };
```

---

## Мониторинг и логи

### Просмотр логов в реальном времени
```bash
wrangler tail flashcards-api
wrangler tail flashcards-collaboration
```

### Проверка использования лимитов
Откройте [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → выберите Worker → вкладка **Metrics**:
- Запросы в секунду
- CPU-время (макс 10 мс на запрос в Free Tier)
- Ошибки и статус-коды

---

## Обновление Worker'а после изменений

После правки `worker.js` или `wrangler.jsonc`:
```bash
wrangler deploy
```
Изменения применяются мгновенно (rollout 30-60 секунд).

---

## Удаление ресурсов (если больше не нужны)

### Удалить Worker
```bash
wrangler delete flashcards-api
wrangler delete flashcards-collaboration
```

### Удалить базу данных D1
```bash
wrangler d1 delete flashcards-db
```

### Удалить приложение Cloudflare Calls
Перейдите в Dashboard → Calls → удалите приложение вручную.

---

**Готово!** Приложение полностью развёрнуто в облаке Cloudflare и работает без серверов. 🎉

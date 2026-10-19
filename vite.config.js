import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Точка входа Vite — app.html, чтобы не конфликтовать с index.html в корне после публикации.
export default defineConfig({
  plugins: [
    vue(),
    // После сборки копируем dist → корень репозитория для GitHub Pages (deploy из ветки)
    // и переименовываем dist/app.html → dist/index.html + ./index.html.
    {
      name: 'publish-to-root',
      closeBundle() {
        const dist = 'dist';
        if (!existsSync(dist)) return;

        // Переименовываем dist/app.html в dist/index.html для GitHub Actions и корня
        const distAppHtml = join(dist, 'app.html');
        const distIndexHtml = join(dist, 'index.html');
        if (existsSync(distAppHtml)) {
          copyFileSync(distAppHtml, distIndexHtml);
        }

        // Очищаем старую папку assets в корне и старый index.html
        rmSync('assets', { recursive: true, force: true });

        // Копируем собранные файлы в корень (кроме app.html, чтобы не затереть исходный шаблон)
        for (const entry of readdirSync(dist)) {
          if (entry === 'app.html') continue;
          const from = join(dist, entry);
          const to = join('.', entry);
          if (statSync(from).isDirectory()) {
            mkdirSync(to, { recursive: true });
            for (const file of readdirSync(from)) {
              copyFileSync(join(from, file), join(to, file));
            }
          } else {
            copyFileSync(from, to);
          }
        }

        console.log('Готовая сборка опубликована в index.html и assets/.');
      }
    }
  ],
  base: '/engTeachDasha/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: 'app.html'
    }
  }
});

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Базовый путь соответствует адресу GitHub Pages: https://imadji.github.io/engTeachDasha/
export default defineConfig({
  plugins: [vue()],
  base: '/engTeachDasha/',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});

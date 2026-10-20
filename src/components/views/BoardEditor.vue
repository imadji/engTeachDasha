<script setup>
/**
 * Полноэкранный редактор доски в стиле Miro:
 * - Занимает всю доступную площадь окна без прокрутки страницы;
 * - Плавающая левая палитра инструментов (включая Фреймы и Изображения);
 * - Плавающая панель фреймов и быстрых шаблонов;
 * - Модальное окно вставки изображений: загрузка с компьютера, Ctrl+V или прямая ссылка.
 */
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { BoardCanvas, boardUi, compressImageFileToDataUrl } from '../../lib/boardCanvas';
import BaseModal from '../modals/BaseModal.vue';

const props = defineProps({ url: String });

const tools = [
  ['select', '↖', 'Выделение и перемещение (V)'],
  ['pan', '✋', 'Панорама холста (H)'],
  ['frame', '⊞', 'Растянуть новый фрейм (F)'],
  ['sticker', '▣', 'Стикер (S)'],
  ['text', 'T', 'Текст (T)'],
  ['pen', '✎', 'Карандаш (P)'],
  ['rect', '▭', 'Прямоугольник (R)'],
  ['ellipse', '○', 'Круг (O)'],
  ['arrow', '↗', 'Стрелка (A)'],
  ['line', '╱', 'Линия (L)'],
  ['eraser', '⌫', 'Ластик (E)']
];

const showFramesDrawer = ref(false);
const imageTab = ref('upload'); // 'upload' | 'url'
const imageUrlInput = ref('');
const imageError = ref('');
const imageBusy = ref(false);
const fileInputRef = ref(null);

function selectTool(id) {
  BoardCanvas.choose(id);
}

function openImageModal() {
  imageError.value = '';
  imageUrlInput.value = '';
  boardUi.imageModalOpen = true;
}

async function onFilePicked(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  await insertFileImage(file);
}

async function onModalDrop(event) {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (file) await insertFileImage(file);
}

async function insertFileImage(file) {
  imageBusy.value = true;
  imageError.value = '';
  try {
    const { dataUrl, width, height } = await compressImageFileToDataUrl(file);
    if (BoardCanvas.addImageObject(dataUrl, width, height)) {
      boardUi.imageModalOpen = false;
    }
  } catch (e) {
    imageError.value = e.message;
  } finally {
    imageBusy.value = false;
  }
}

async function insertUrlImage() {
  const raw = imageUrlInput.value.trim();
  if (!raw) return;
  imageBusy.value = true;
  imageError.value = '';
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    const dims = await new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth || 360, h: img.naturalHeight || 260 });
      img.onerror = () => resolve({ w: 360, h: 260 });
      img.src = raw;
    });
    if (BoardCanvas.addImageObject(raw, dims.w, dims.h)) {
      boardUi.imageModalOpen = false;
    }
  } catch {
    imageError.value = 'Укажите корректную прямую ссылку HTTP(S) на изображение.';
  } finally {
    imageBusy.value = false;
  }
}

onMounted(() => {
  BoardCanvas.open(props.url);
});

onBeforeUnmount(() => {
  BoardCanvas.close();
});
</script>

<template>
  <div class="miro-stage">
    <!-- Полноэкранный холст -->
    <canvas id="boardCanvas" aria-label="Интерактивная доска" />

    <!-- Левая плавающая палитра инструментов (как в Miro) -->
    <aside class="miro-left-dock" aria-label="Инструменты доски">
      <button
        v-for="[id, icon, label] in tools"
        :key="id"
        type="button"
        class="miro-tool-btn"
        :class="{ active: boardUi.tool === id }"
        :title="label"
        @click="selectTool(id)"
      >
        {{ icon }}
      </button>

      <button
        type="button"
        class="miro-tool-btn"
        title="Вставить изображение (с компьютера, Ctrl+V или по ссылке)"
        @click="openImageModal"
      >
        🖼
      </button>

      <span class="miro-dock-divider" />

      <label class="miro-color-swatch" title="Цвет линий и фигур">
        <input id="boardColorInput" type="color" value="#5b82a6" aria-label="Цвет линий" />
      </label>
      <label class="miro-color-swatch" title="Цвет стикера">
        <input id="boardStickerColorInput" type="color" value="#fdf6e7" aria-label="Цвет стикера" />
      </label>

      <span class="miro-dock-divider" />

      <button
        type="button"
        class="miro-tool-btn"
        title="На передний план"
        :disabled="!boardUi.hasSelection"
        @click="BoardCanvas.bringToFront()"
      >
        ⇈
      </button>
      <button
        type="button"
        class="miro-tool-btn"
        title="На задний план"
        :disabled="!boardUi.hasSelection"
        @click="BoardCanvas.sendToBack()"
      >
        ⇊
      </button>
      <button
        type="button"
        class="miro-tool-btn danger"
        title="Удалить выбранный объект (Delete)"
        :disabled="!boardUi.hasSelection"
        @click="BoardCanvas.deleteSelected()"
      >
        🗑
      </button>
    </aside>

    <!-- Верхняя левая панель навигации по Фреймам -->
    <div class="miro-top-left">
      <button type="button" class="miro-pill-btn" @click="showFramesDrawer = !showFramesDrawer">
        ⊞ Фреймы ({{ boardUi.frames.length }})
      </button>
      <button type="button" class="miro-pill-btn" @click="BoardCanvas.addPresetFrame()">
        + Новый фрейм
      </button>
    </div>

    <!-- Выпадающий список фреймов с быстрым переходом -->
    <div v-if="showFramesDrawer" class="miro-frames-popover">
      <div class="miro-frames-header">
        <strong>Фреймы на доске</strong>
        <button type="button" class="icon-btn" @click="showFramesDrawer = false">✕</button>
      </div>
      <p v-if="!boardUi.frames.length" class="form-hint">
        Фреймов пока нет. Нажмите «+ Новый фрейм» или выберите инструмент ⊞ слева.
      </p>
      <div v-else class="miro-frames-list">
        <button
          v-for="(f, idx) in boardUi.frames"
          :key="f.id"
          type="button"
          class="miro-frame-item"
          @click="BoardCanvas.focusFrame(f.id)"
        >
          <span class="miro-frame-num">{{ idx + 1 }}</span>
          <span class="miro-frame-name">{{ f.title }}</span>
        </button>
      </div>
      <div class="miro-frames-presets">
        <button type="button" class="btn btn-secondary btn-sm" @click="BoardCanvas.addPresetFrame('Слайд 16:9', 960, 540)">
          + 16:9 Слайд
        </button>
        <button type="button" class="btn btn-secondary btn-sm" @click="BoardCanvas.addPresetFrame('Лист A4', 620, 860)">
          + A4 Лист
        </button>
      </div>
    </div>

    <!-- Нижняя правая плавающая панель масштаба и статуса (как в Miro) -->
    <div class="miro-bottom-right">
      <span class="miro-ws-badge" :class="boardUi.wsStatusKind">{{ boardUi.wsStatusText }}</span>
      <button type="button" class="miro-zoom-btn" title="Отдалить" @click="BoardCanvas.zoomBy(1 / 1.2)">−</button>
      <span class="miro-zoom-label">{{ boardUi.zoomPercent }}%</span>
      <button type="button" class="miro-zoom-btn" title="Приблизить" @click="BoardCanvas.zoomBy(1.2)">+</button>
      <button type="button" class="miro-pill-btn" title="Показать всю доску" @click="BoardCanvas.fit()">Вписать</button>
      <button type="button" class="miro-pill-btn danger" title="Очистить всю доску" @click="BoardCanvas.clearBoard()">
        Очистить
      </button>
    </div>

    <!-- Модальное окно вставки изображения (Файл с ПК / Ctrl+V / Ссылка) -->
    <BaseModal
      v-if="boardUi.imageModalOpen"
      title="Добавить изображение на доску"
      :busy="imageBusy"
      @close="!imageBusy && (boardUi.imageModalOpen = false)"
    >
      <div class="miro-img-tabs">
        <button
          type="button"
          class="btn btn-sm"
          :class="imageTab === 'upload' ? 'btn-primary' : 'btn-secondary'"
          @click="imageTab = 'upload'"
        >
          📁 С компьютера / Ctrl+V
        </button>
        <button
          type="button"
          class="btn btn-sm"
          :class="imageTab === 'url' ? 'btn-primary' : 'btn-secondary'"
          @click="imageTab = 'url'"
        >
          🔗 По ссылке (URL)
        </button>
      </div>

      <div v-if="imageTab === 'upload'" class="miro-dropzone" @dragover.prevent @drop="onModalDrop">
        <p class="miro-dropzone-title">Перетащите картинку сюда или выберите файл</p>
        <p class="form-hint">
          Поддерживаются PNG, JPG, WebP и GIF. Также можно просто нажать <strong>Ctrl + V</strong> прямо на холсте доски!
        </p>
        <input ref="fileInputRef" type="file" accept="image/*" hidden @change="onFilePicked" />
        <button type="button" class="btn btn-primary" :disabled="imageBusy" @click="fileInputRef?.click()">
          {{ imageBusy ? 'Обрабатываем…' : 'Выбрать файл на компьютере' }}
        </button>
      </div>

      <form v-else class="miro-url-form" @submit.prevent="insertUrlImage">
        <label class="form-group">
          <span class="form-label">Прямая ссылка на картинку (https://)</span>
          <input
            v-model="imageUrlInput"
            type="url"
            class="form-input"
            placeholder="https://images.unsplash.com/..."
            required
          />
        </label>
        <div class="modal-footer">
          <button type="submit" class="btn btn-primary" :disabled="imageBusy">Вставить на доску</button>
        </div>
      </form>

      <p v-if="imageError" class="form-error" role="alert">{{ imageError }}</p>
    </BaseModal>
  </div>
</template>

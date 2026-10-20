<script setup>
/**
 * Красивое модальное окно ввода текста на доске — замена системному prompt().
 * Используется для стикеров, текстовых блоков и переименования фреймов.
 * Поддерживает однострочный и многострочный ввод, Enter — сохранить, Escape — отменить.
 */
import { nextTick, ref, watch } from 'vue';
import BaseModal from './BaseModal.vue';
import { boardUi, resolveBoardText } from '../../lib/boardCanvas';

const inputRef = ref(null);
const localValue = ref('');

watch(
  () => boardUi.textModalOpen,
  async open => {
    if (open) {
      localValue.value = boardUi.textModal.value;
      await nextTick();
      inputRef.value?.focus();
      inputRef.value?.select();
    }
  }
);

function submit() {
  resolveBoardText(localValue.value.trim());
}

function cancel() {
  resolveBoardText(null);
}
</script>

<template>
  <BaseModal
    v-if="boardUi.textModalOpen"
    :title="boardUi.textModal.title"
    @close="cancel()"
  >
    <form @submit.prevent="submit">
      <div class="form-group">
        <label class="form-label" :for="boardUi.textModal.multiline ? 'board-text-area' : 'board-text-input'">
          Текст
          <span class="optional-tag">({{ boardUi.textModal.multiline ? 'Enter — новая строка' : 'Enter — сохранить' }})</span>
        </label>

        <textarea
          v-if="boardUi.textModal.multiline"
          id="board-text-area"
          ref="inputRef"
          v-model="localValue"
          class="form-textarea board-text-textarea"
          :placeholder="boardUi.textModal.placeholder"
          rows="4"
          maxlength="5000"
        />

        <input
          v-else
          id="board-text-input"
          ref="inputRef"
          v-model="localValue"
          type="text"
          class="form-input"
          :placeholder="boardUi.textModal.placeholder"
          maxlength="160"
        />
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-ghost" @click="cancel">Отмена</button>
        <button type="submit" class="btn btn-primary" :disabled="!localValue.trim()">
          {{ boardUi.textModal.submitLabel }}
        </button>
      </div>
    </form>
  </BaseModal>
</template>

<style scoped>
.board-text-textarea {
  min-height: 120px;
  resize: vertical;
}
</style>

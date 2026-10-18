<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue';
defineProps({ title: String, wide: Boolean, busy: Boolean });
const emit = defineEmits(['close']);
const root = ref(null);
let previous;
function keys(e) {
  if (e.key === 'Escape') emit('close');
  if (e.key !== 'Tab') return;
  const items = [...root.value.querySelectorAll('button:not(:disabled),input,textarea,select,a[href]')];
  const first = items[0], last = items.at(-1);
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
}
onMounted(() => { previous = document.activeElement; document.body.style.overflow = 'hidden'; root.value.querySelector('input,button')?.focus(); });
onBeforeUnmount(() => { document.body.style.overflow = ''; previous?.focus(); });
</script>
<template><Teleport to="body"><div ref="root" class="modal-overlay" @keydown="keys" @click.self="!busy && emit('close')"><section class="modal-window" :class="{ 'modal-window-lg': wide }" role="dialog" aria-modal="true" :aria-label="title"><header class="modal-header"><h2 class="modal-title">{{ title }}</h2><button class="modal-close-btn" :disabled="busy" aria-label="Закрыть" @click="emit('close')">✕</button></header><div class="modal-body"><slot /></div></section></div></Teleport></template>

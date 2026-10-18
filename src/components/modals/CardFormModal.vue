<script setup>
import { reactive, ref } from 'vue';
import BaseModal from './BaseModal.vue';
import { useLessonsStore } from '../../stores/lessonsStore';
const props = defineProps({ card: Object, action: Function });
const emit = defineEmits(['close']);
const form = reactive({ imageUrl: '', text: '', translation: '', ...props.card });
const busy = ref(false), error = ref(''); const { isValidUrl, FALLBACK_IMAGE_URI } = useLessonsStore();
async function submit() {
  const value = Object.fromEntries(Object.entries(form).map(([k,v]) => [k, String(v).trim()]));
  if (!isValidUrl(value.imageUrl) || !value.text || !value.translation) { error.value = 'Нужны ссылка HTTP(S), английский текст и перевод на русский.'; return; }
  busy.value = true;
  try { if (await props.action(value) !== false) emit('close'); } catch(e) { error.value = e.message; } finally { busy.value = false; }
}
</script>
<template><BaseModal :title="card ? 'Редактировать карточку' : 'Добавить карточку'" :busy="busy" @close="!busy && emit('close')"><form @submit.prevent="submit"><div class="form-group"><label class="form-label">Ссылка на изображение *</label><input v-model="form.imageUrl" class="form-input" type="url" required /><img v-if="form.imageUrl" :key="form.imageUrl" :src="form.imageUrl" class="image-preview" alt="Предпросмотр" @error="$event.target.src = FALLBACK_IMAGE_URI" /></div><div class="form-group"><label class="form-label">Текст на английском *</label><input v-model="form.text" class="form-input" required maxlength="200" /></div><div class="form-group"><label class="form-label">Перевод на русский *</label><input v-model="form.translation" class="form-input" required maxlength="200" /></div><p class="form-error" role="alert">{{ error }}</p><div class="modal-footer"><button class="btn btn-primary" :disabled="busy">{{ busy ? 'Сохраняем…' : 'Сохранить карточку' }}</button></div></form></BaseModal></template>

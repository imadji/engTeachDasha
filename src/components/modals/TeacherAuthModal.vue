<script setup>
import { ref, watch } from 'vue';
import BaseModal from './BaseModal.vue';
import { useAppStore } from '../../stores/appStore';
import { COLLAB_API_URL } from '../../config/api';
const app = useAppStore();
const token = ref(''), visible = ref(false), remember = ref(false), busy = ref(false), error = ref('');
watch(app.authModalOpen, open => { if (open) { token.value = app.teacherToken.value || ''; error.value = ''; } });
async function submit() {
  if (!token.value.trim()) { error.value = 'Введите ключ учителя.'; return; }
  busy.value = true; error.value = '';
  try {
    const r = await fetch(`${COLLAB_API_URL}/boards`, { headers: { 'X-Teacher-Token': token.value.trim() } });
    if (!r.ok) throw Error(r.status === 403 ? 'Ключ не подошёл. Проверьте его и попробуйте ещё раз.' : 'Сервер недоступен. Попробуйте позже.');
    app.setTeacherToken(token.value.trim(), remember.value); app.resolveAuthSuccess(); app.toast('Доступ учителя подтверждён');
  } catch (e) { error.value = e.message; } finally { busy.value = false; }
}
async function paste() { try { token.value = await navigator.clipboard.readText(); } catch { error.value = 'Вставьте ключ вручную (Ctrl+V).'; } }
</script>
<template><BaseModal v-if="app.authModalOpen.value" title="Ключ учителя" :busy="busy" @close="!busy && app.closeAuthModal()"><form @submit.prevent="submit"><p class="screen-subtitle">{{ app.authModalHint.value || 'Подтвердите доступ к доскам и видеозвонкам.' }}</p><div class="form-group auth-field"><label class="form-label" for="teacher-key">Ваш ключ доступа</label><div class="actions"><input id="teacher-key" v-model="token" class="form-input" :type="visible ? 'text' : 'password'" autocomplete="off" :aria-invalid="!!error" placeholder="Вставьте ключ учителя" /><button type="button" class="btn btn-secondary" :aria-label="visible ? 'Скрыть ключ' : 'Показать ключ'" @click="visible = !visible">{{ visible ? 'Скрыть' : 'Показать' }}</button></div><button type="button" class="btn btn-ghost btn-sm" @click="paste">Вставить из буфера</button><p class="form-error" role="alert">{{ error }}</p></div><label class="checkbox-card"><input v-model="remember" type="checkbox" /> Запомнить на этом устройстве</label><div class="modal-footer"><button type="button" class="btn btn-ghost" :disabled="busy" @click="app.closeAuthModal()">Отмена</button><button class="btn btn-primary" :disabled="busy">{{ busy ? 'Проверяем…' : 'Проверить и войти' }}</button></div></form></BaseModal></template>

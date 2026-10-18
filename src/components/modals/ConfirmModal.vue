<script setup>
import { ref } from 'vue';
import BaseModal from './BaseModal.vue';
const props = defineProps({ title: String, message: String, action: Function });
const emit = defineEmits(['close']); const busy = ref(false), error = ref('');
async function confirm() { busy.value = true; try { if (await props.action() !== false) emit('close'); } catch(e) { error.value = e.message; } finally { busy.value = false; } }
</script>
<template><BaseModal :title="title" :busy="busy" @close="!busy && emit('close')"><p>{{ message }}</p><p class="form-error">{{ error }}</p><div class="modal-footer"><button class="btn btn-ghost" :disabled="busy" @click="emit('close')">Отмена</button><button class="btn btn-danger" :disabled="busy" @click="confirm">{{ busy ? 'Удаляем…' : 'Удалить' }}</button></div></BaseModal></template>

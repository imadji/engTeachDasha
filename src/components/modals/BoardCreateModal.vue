<script setup>
import { ref } from 'vue';
import BaseModal from './BaseModal.vue';
import { useCollabStore } from '../../stores/collabStore';
const emit=defineEmits(['close','created']); const title=ref(''), busy=ref(false), error=ref(''); const store=useCollabStore();
async function submit() { if(!title.value.trim()) return; busy.value=true; try {emit('created',await store.createBoard(title.value.trim()));} catch(e){error.value=e.message;} finally {busy.value=false;} }
</script>
<template><BaseModal title="Новая доска" :busy="busy" @close="!busy && emit('close')"><form @submit.prevent="submit"><label class="form-group">Название доски<input v-model="title" class="form-input" required maxlength="120" placeholder="Например: Present Continuous" /></label><p class="form-error">{{ error }}</p><div class="modal-footer"><button class="btn btn-primary" :disabled="busy">{{busy?'Создаём…':'Создать доску'}}</button></div></form></BaseModal></template>

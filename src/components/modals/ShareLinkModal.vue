<script setup>
import BaseModal from './BaseModal.vue';
import { useAppStore } from '../../stores/appStore';
const props = defineProps({ link: String, title: { default: 'Поделиться ссылкой' } });
defineEmits(['close']); const { toast } = useAppStore();
async function copy() { try { await navigator.clipboard.writeText(props.link); toast('Ссылка скопирована'); } catch { toast('Выделите ссылку и скопируйте её вручную', true); } }
</script>
<template><BaseModal :title="title" @close="$emit('close')"><p class="screen-subtitle">Отправьте эту ссылку ученику для присоединения.</p><input :value="link" class="form-input" readonly aria-label="Ссылка-приглашение" @focus="$event.target.select()" /><button class="btn btn-primary" @click="copy">Скопировать ссылку</button></BaseModal></template>

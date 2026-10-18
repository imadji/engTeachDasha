<script setup>
import { useAppStore } from '../../stores/appStore';
const { toasts } = useAppStore();
</script>
<template><div class="toast-container" aria-live="polite"><div v-for="t in toasts" :key="t.id" class="toast" :class="{ 'toast-error': t.isError }">{{ t.message }}</div></div></template>

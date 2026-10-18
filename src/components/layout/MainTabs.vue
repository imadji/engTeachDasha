<script setup>
import { useAppStore } from '../../stores/appStore';
const app = useAppStore();
const tabs = [{ id: 'lessons', title: 'Уроки', icon: '▤' }, { id: 'boards', title: 'Доски', icon: '▧' }, { id: 'calls', title: 'Видеозвонки', icon: '◉' }];
</script>
<template><nav class="main-tabs" aria-label="Разделы приложения"><button v-for="tab in tabs" :key="tab.id" class="main-tab" :class="{ active: app.activeTab.value === tab.id }" :aria-current="app.activeTab.value === tab.id ? 'page' : undefined" @click="app.setTab(tab.id)">{{ tab.icon }} {{ tab.title }}</button></nav></template>

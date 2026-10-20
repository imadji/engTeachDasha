<script setup>
import { useAppStore } from '../../stores/appStore';
defineProps({ compact: Boolean });
const app = useAppStore();
function home() { app.setTab('lessons'); app.lessonsScreen.value = 'list'; }
</script>
<template>
  <header class="app-header" :class="{ 'app-header-compact': compact }"><div class="container header-row" :class="{ 'header-row-compact': compact }">
    <button class="brand" @click="home"><span class="brand-icon">▤</span><span>English Flashcards<small v-if="!compact">{{ app.isTeacher.value ? 'Кабинет преподавателя' : 'Кабинет ученика' }}</small></span></button>
    <div class="actions">
      <button v-if="app.isTeacher.value" class="btn btn-secondary btn-sm" @click="app.openAuthModal('Доступ к доскам и звонкам')">{{ app.teacherToken.value ? '✓ Ключ учителя' : 'Ввести ключ' }}</button>
      <button class="btn btn-ghost btn-sm" @click="app.setRole(null)">Сменить роль</button>
      <button class="btn btn-secondary btn-sm" :aria-label="app.theme.value === 'light' ? 'Включить тёмную тему' : 'Включить светлую тему'" @click="app.toggleTheme">{{ app.theme.value === 'light' ? '☾' : '☀' }}</button>
    </div>
  </div></header>
</template>

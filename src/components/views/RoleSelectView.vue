<script setup>
import { useAppStore } from '../../stores/appStore';
const app = useAppStore();
function select(role) { app.setRole(role); app.setTab('lessons'); app.lessonsScreen.value = 'list'; if (role === 'teacher' && !app.teacherToken.value) app.openAuthModal('Для доступа к вашим доскам и видеозвонкам'); }
</script>
<template><main class="role-wrapper container"><section class="role-card"><span class="badge badge-cards">English Flashcards</span><h1>Ваше пространство для английского</h1><p class="screen-subtitle">Уроки, визуальные карточки и совместная практика — всё в одном месте.</p><div class="role-grid"><button class="role-choice" @click="select('student')"><span>◉</span><h2>Я ученик</h2><p>Изучайте уроки и тренируйте слова с карточками.</p></button><button class="role-choice" @click="select('teacher')"><span>✎</span><h2>Я учитель</h2><p>Создавайте материалы, рисуйте на доске и проводите занятия.</p></button></div></section></main></template>

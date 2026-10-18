<script setup>
/**
 * Корневой компонент приложения.
 * Управляет глобальными экранами: выбор роли, главный экран с вкладками, шапка, тосты, модалки.
 */
import { computed, onMounted, provide } from 'vue';
import { useAppStore } from './stores/appStore.js';
import AppHeader from './components/layout/AppHeader.vue';
import ToastContainer from './components/layout/ToastContainer.vue';
import RoleSelectView from './components/views/RoleSelectView.vue';
import MainTabs from './components/layout/MainTabs.vue';
import LessonsListView from './components/views/LessonsListView.vue';
import LessonDetailView from './components/views/LessonDetailView.vue';
import TrainingView from './components/views/TrainingView.vue';
import BoardsView from './components/views/BoardsView.vue';
import CallsView from './components/views/CallsView.vue';
import TeacherAuthModal from './components/modals/TeacherAuthModal.vue';

const app = useAppStore();

// Роутинг URL-параметров: прямые ссылки ученика ?board=...&key=... / ?call=...&key=...
function handleUrlRouting() {
  const params = new URLSearchParams(location.search);
  const boardId = params.get('board');
  const callId = params.get('call');
  const key = params.get('key') || '';

  if (callId) {
    if (!app.role.value) app.setRole('student');
    app.currentCallRoomId.value = callId;
    app.currentCallKey.value = key;
    app.setCallContext(null);
    app.setTab('calls');
    return true;
  }

  if (boardId) {
    if (!app.role.value) app.setRole('student');
    app.currentBoardId.value = boardId;
    app.currentBoardKey.value = key;
    app.setTab('boards');
    app.boardsScreen.value = 'board';
    return true;
  }

  return false;
}

onMounted(() => {
  app.restoreTeacherToken();
  const routed = handleUrlRouting();
  if (!routed && !app.role.value) {
    // Нет роли и нет ссылки-приглашения — показываем выбор роли
    app.setTab('lessons');
  }
});

// Список уроков подгружается лениво при первом входе на вкладку уроков
const showRoleSelection = computed(() => !app.role.value);
</script>

<template>
  <!-- Шапка приложения -->
  <AppHeader v-if="!showRoleSelection" />

  <!-- Экран выбора роли -->
  <RoleSelectView v-if="showRoleSelection" />

  <!-- Главный экран с вкладками -->
  <main v-else class="main-content">
    <div class="container">
      <MainTabs />

      <!-- Вкладка «Уроки» (главная) -->
      <template v-if="app.activeTab.value === 'lessons'">
        <TrainingView v-if="app.lessonsScreen.value === 'training'" />
        <LessonDetailView v-else-if="app.lessonsScreen.value === 'lesson'" />
        <LessonsListView v-else />
      </template>

      <!-- Вкладка «Доски» -->
      <BoardsView v-else-if="app.activeTab.value === 'boards'" />

      <!-- Вкладка «Видеозвонки» -->
      <CallsView v-else />
    </div>
  </main>

  <!-- Тосты и модальное окно токена учителя -->
  <ToastContainer />
  <TeacherAuthModal />
</template>

<style scoped>
.main-content {
  padding-top: 24px;
  padding-bottom: 56px;
  animation: fadeIn 0.3s ease;
}
</style>

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

// Полноэкранный режим без прокрутки страницы: когда открыт холст доски или вкладка видеозвонков
const isWorkspaceMode = computed(
  () =>
    !showRoleSelection.value &&
    (app.activeTab.value === 'calls' ||
      (app.activeTab.value === 'boards' && app.boardsScreen.value === 'board'))
);
</script>

<template>
  <div class="app-shell" :class="{ 'app-shell-workspace': isWorkspaceMode }">
    <!-- Шапка приложения (компактная в режиме доски/звонка) -->
    <AppHeader v-if="!showRoleSelection" :compact="isWorkspaceMode" />

    <!-- Экран выбора роли -->
    <RoleSelectView v-if="showRoleSelection" />

    <!-- Главный экран с вкладками -->
    <main v-else class="main-content" :class="{ 'main-content-workspace': isWorkspaceMode }">
      <div class="container" :class="{ 'container-workspace': isWorkspaceMode }">
        <MainTabs :compact="isWorkspaceMode" />

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
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100svh;
  display: flex;
  flex-direction: column;
}

.app-shell-workspace {
  height: 100svh;
  max-height: 100svh;
  overflow: hidden;
}

.main-content {
  flex: 1;
  padding-top: 24px;
  padding-bottom: 56px;
  animation: fadeIn 0.3s ease;
}

.main-content-workspace {
  padding-top: 8px;
  padding-bottom: 8px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.container-workspace {
  flex: 1;
  min-height: 0;
  max-width: 100%;
  padding: 0 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>

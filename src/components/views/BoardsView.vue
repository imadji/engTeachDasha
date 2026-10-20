<script setup>
import { onMounted, ref } from 'vue';
import { useAppStore } from '../../stores/appStore';
import { useCollabStore } from '../../stores/collabStore';
import BoardEditor from './BoardEditor.vue';
import BoardCreateModal from '../modals/BoardCreateModal.vue';
import ShareLinkModal from '../modals/ShareLinkModal.vue';
import ConfirmModal from '../modals/ConfirmModal.vue';

const app = useAppStore();
const store = useCollabStore();

const board = ref(null);
const url = ref('');
const loading = ref(false);
const error = ref('');
const creating = ref(false);
const share = ref('');
const deleting = ref(null);

async function load() {
  if (!app.isTeacher.value) return;
  if (!store.requireTeacher(load, 'для просмотра ваших досок')) return;
  await store.fetchBoards();
}

async function open(id, key = null) {
  loading.value = true;
  error.value = '';
  try {
    board.value = await store.getBoard(id, key);
    app.currentBoardId.value = id;
    app.currentBoardKey.value = key;
    url.value = store.buildBoardSocketUrl(id, {
      boardKey: key,
      teacherTokenValue: app.isTeacher.value ? app.teacherToken.value : null
    });
    app.boardsScreen.value = 'board';
  } catch (e) {
    error.value = e.message;
    app.boardsScreen.value = 'list';
  } finally {
    loading.value = false;
  }
}

function back() {
  board.value = null;
  app.currentBoardId.value = null;
  app.boardsScreen.value = 'list';
  void load();
}

async function invite(id) {
  try {
    share.value = store.buildBoardInviteLink(id, await store.createBoardInvite(id));
  } catch (e) {
    error.value = e.message;
  }
}

async function created(result) {
  creating.value = false;
  await open(result.board.id, result.key);
  share.value = store.buildBoardInviteLink(result.board.id, result.key);
}

onMounted(() => {
  if (app.currentBoardId.value) void open(app.currentBoardId.value, app.currentBoardKey.value);
  else {
    app.boardsScreen.value = 'list';
    void load();
  }
});
</script>

<template>
  <section class="boards-view-root" :class="{ 'boards-view-fullscreen': Boolean(board) }">
    <template v-if="board">
      <!-- Компактная верхняя панель открытой доски -->
      <div class="miro-board-header">
        <div class="actions">
          <button class="btn btn-ghost btn-sm" @click="back">← К списку досок</button>
          <strong class="miro-board-title">{{ board.title }}</strong>
        </div>
        <div class="actions">
          <button v-if="app.isTeacher.value" class="btn btn-secondary btn-sm" @click="invite(board.id)">
            🔗 Пригласить ученика
          </button>
          <button
            class="btn btn-accent btn-sm"
            @click="
              app.setCallContext({ tab: 'boards' });
              app.setTab('calls');
            "
          >
            📹 Видеозвонок
          </button>
        </div>
      </div>

      <BoardEditor :key="board.id" :url="url" />
    </template>

    <template v-else>
      <div class="section-row">
        <div>
          <h1 class="screen-title">Интерактивные доски</h1>
          <p class="screen-subtitle">Создавайте фреймы, вставляйте картинки (Ctrl+V) и рисуйте вместе с учеником</p>
        </div>
        <div v-if="app.isTeacher.value" class="actions">
          <button class="btn btn-secondary" @click="load">Обновить</button>
          <button class="btn btn-primary" @click="store.requireTeacher(() => (creating = true)) && (creating = true)">
            + Создать доску
          </button>
        </div>
      </div>

      <div v-if="loading || store.boardsLoading.value" class="loading-state"><div class="spinner" /></div>
      <div v-else-if="!app.isTeacher.value" class="empty-state">
        <h3>Присоединитесь к доске</h3>
        <p>Откройте ссылку-приглашение, которую отправил преподаватель.</p>
      </div>
      <div v-else-if="!store.boards.value.length" class="empty-state">
        <h3>Досок пока нет</h3>
        <p>Создайте первую доску для совместной работы с учеником.</p>
      </div>
      <div v-else class="lessons-grid">
        <article v-for="b in store.boards.value" :key="b.id" class="lesson-card">
          <span class="badge badge-published">Совместная доска</span>
          <h2>{{ b.title }}</h2>
          <div class="actions">
            <button class="btn btn-primary" @click="open(b.id)">Открыть</button>
            <button class="btn btn-ghost" @click="invite(b.id)">Поделиться</button>
            <button class="icon-btn danger" aria-label="Удалить доску" @click="deleting = b">✕</button>
          </div>
        </article>
      </div>
    </template>

    <p v-if="error" class="error-banner" role="alert">{{ error }}</p>
    <BoardCreateModal v-if="creating" @close="creating = false" @created="created" />
    <ShareLinkModal v-if="share" :link="share" title="Приглашение на доску" @close="share = ''" />
    <ConfirmModal
      v-if="deleting"
      title="Удалить доску?"
      :message="deleting.title"
      :action="() => store.deleteBoard(deleting.id)"
      @close="deleting = null"
    />
  </section>
</template>

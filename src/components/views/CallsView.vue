<script setup>
/**
 * Видеозвонки в стиле Zoom:
 * - Занимают всю доступную высоту экрана без прокрутки страницы;
 * - Тёмная видеосцена, адаптивная сетка участников, режимы «Галерея» и «Докладчик»;
 * - Нижняя панель управления с микрофоном, камерой, демонстрацией экрана, приглашением и выходом.
 */
import { onMounted, onBeforeUnmount, ref, nextTick } from 'vue';
import { useAppStore } from '../../stores/appStore';
import { useCollabStore } from '../../stores/collabStore';
import { VideoCall, callState } from '../../lib/realtimeCall';
import ShareLinkModal from '../modals/ShareLinkModal.vue';

const app = useAppStore();
const store = useCollabStore();

const name = ref('');
const error = ref('');
const busy = ref(false);
const share = ref('');
const inviteInput = ref('');
const stageRef = ref(null);
const isFullscreen = ref(false);

async function createAndJoinRoom() {
  if (!store.requireTeacher(createAndJoinRoom, 'для создания видеозвонка')) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await store.createCallRoom();
    app.currentCallRoomId.value = result.roomId;
    app.currentCallKey.value = result.key;
    share.value = store.buildCallInviteLink(result.roomId, result.key);
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

async function joinRoom() {
  if (!app.currentCallRoomId.value) return;
  busy.value = true;
  error.value = '';
  try {
    await nextTick();
    await VideoCall.join(() =>
      store.getCallToken(
        app.currentCallRoomId.value,
        name.value.trim() || (app.isTeacher.value ? 'Преподаватель' : 'Ученик'),
        app.currentCallKey.value
      )
    );
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

async function leaveRoom() {
  await VideoCall.leave();
  app.currentCallRoomId.value = null;
  app.currentCallKey.value = null;
  const ctx = app.getCallContext();
  if (ctx?.tab) {
    app.setCallContext(null);
    app.setTab(ctx.tab);
  }
}

function parseInviteLink() {
  try {
    const u = new URL(inviteInput.value.trim());
    const p = new URLSearchParams(u.search);
    const id = p.get('call');
    const key = p.get('key');
    if (!id || !key) throw new Error();
    app.currentCallRoomId.value = id;
    app.currentCallKey.value = key;
    error.value = '';
  } catch {
    error.value = 'Вставьте полную ссылку-приглашение на звонок.';
  }
}

function openInviteModal() {
  if (!app.currentCallRoomId.value) return;
  share.value = store.buildCallInviteLink(app.currentCallRoomId.value, app.currentCallKey.value || '');
}

async function toggleFullscreen() {
  const el = stageRef.value;
  if (!el) return;
  try {
    if (!document.fullscreenElement) {
      await el.requestFullscreen();
      isFullscreen.value = true;
    } else {
      await document.exitFullscreen();
      isFullscreen.value = false;
    }
  } catch {
    /* игнорируем */
  }
}

function onFullscreenChange() {
  isFullscreen.value = Boolean(document.fullscreenElement);
}

onMounted(() => {
  VideoCall.init();
  document.addEventListener('fullscreenchange', onFullscreenChange);
});

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  void VideoCall.leave();
});
</script>

<template>
  <section ref="stageRef" class="zoom-workspace">
    <!-- СОСТОЯНИЕ 1: Комната ещё не выбрана (стартовый экран без скролла) -->
    <div v-if="!app.currentCallRoomId.value" class="zoom-lobby-center">
      <div class="zoom-lobby-card">
        <div class="zoom-lobby-badge">Cloudflare Realtime Video</div>
        <h1 class="zoom-lobby-title">Видеозвонок с демонстрацией экрана</h1>
        <p class="zoom-lobby-sub">
          Общайтесь с учеником голосом и видео, делитесь экраном с уроком или интерактивной доской — всё работает прямо в браузере.
        </p>

        <div v-if="app.isTeacher.value" class="zoom-lobby-primary">
          <button class="btn btn-accent btn-lg zoom-full-btn" :disabled="busy" @click="createAndJoinRoom">
            {{ busy ? 'Создаём комнату…' : '📹 Создать новую комнату звонка' }}
          </button>
        </div>

        <div class="zoom-lobby-divider">
          <span>или присоединитесь по ссылке</span>
        </div>

        <form class="zoom-invite-form" @submit.prevent="parseInviteLink">
          <input
            v-model="inviteInput"
            class="form-input"
            placeholder="Вставьте ссылку-приглашение на звонок..."
            aria-label="Ссылка-приглашение на звонок"
            required
          />
          <button class="btn btn-secondary">Открыть</button>
        </form>

        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      </div>
    </div>

    <!-- СОСТОЯНИЕ 2: Предварительный вход в комнату (ввод имени перед подключением) -->
    <div v-else-if="!callState.connected" class="zoom-lobby-center">
      <div class="zoom-lobby-card">
        <div class="zoom-lobby-badge">Комната готова · {{ app.currentCallRoomId.value.slice(0, 8) }}</div>
        <h2 class="zoom-lobby-title">Как вас подписать в звонке?</h2>
        <p class="zoom-lobby-sub">Микрофон и камера при входе выключены по умолчанию — вы сможете включить их внизу экрана.</p>

        <form class="zoom-join-form" @submit.prevent="joinRoom">
          <input
            v-model="name"
            class="form-input"
            :placeholder="app.isTeacher.value ? 'Например: Дарья (Учитель)' : 'Ваше имя'"
            maxlength="40"
            autofocus
          />
          <div class="zoom-join-actions">
            <button type="button" class="btn btn-ghost" :disabled="busy" @click="leaveRoom">Отмена</button>
            <button type="button" v-if="app.currentCallKey.value" class="btn btn-secondary" @click="openInviteModal">
              🔗 Ссылка ученику
            </button>
            <button type="submit" class="btn btn-primary btn-lg" :disabled="busy">
              {{ busy ? 'Подключаемся…' : 'Войти в звонок' }}
            </button>
          </div>
        </form>

        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      </div>
    </div>

    <!-- СОСТОЯНИЕ 3: Активный звонок в стиле Zoom на весь экран -->
    <div v-show="callState.connected" class="zoom-stage">
      <!-- Верхняя компактная панель -->
      <header class="zoom-topbar">
        <div class="zoom-topbar-left">
          <span class="zoom-live-dot" />
          <span class="zoom-room-label">Комната {{ app.currentCallRoomId.value?.slice(0, 8) }}</span>
          <span class="zoom-participants-pill">👥 {{ callState.participantCount }}</span>
        </div>

        <div class="zoom-topbar-right">
          <button
            v-if="callState.audioBlocked"
            type="button"
            class="zoom-top-btn zoom-top-btn-warn"
            @click="VideoCall.resumeAudio()"
          >
            🔊 Включить звук
          </button>
          <button
            type="button"
            class="zoom-top-btn"
            :class="{ active: callState.layout === 'gallery' }"
            @click="VideoCall.setLayout('gallery')"
          >
            ▦ Галерея
          </button>
          <button
            type="button"
            class="zoom-top-btn"
            :class="{ active: callState.layout === 'speaker' }"
            @click="VideoCall.setLayout('speaker')"
          >
            ▣ Докладчик
          </button>
          <button
            v-if="app.currentCallKey.value"
            type="button"
            class="zoom-top-btn"
            @click="openInviteModal"
          >
            🔗 Пригласить
          </button>
          <button type="button" class="zoom-top-btn" @click="toggleFullscreen">
            {{ isFullscreen ? '🗗 Свернуть' : '⛶ На весь экран' }}
          </button>
        </div>
      </header>

      <!-- Центральная адаптивная сетка видео (без прокрутки) -->
      <div class="zoom-video-area">
        <div id="videoGrid" class="zoom-video-grid" data-count="1" data-mode="gallery" />
      </div>

      <!-- Нижний док управления в стиле Zoom -->
      <footer class="zoom-dock">
        <button
          type="button"
          class="zoom-ctrl-btn"
          :class="{ 'is-off': !callState.audioEnabled }"
          @click="VideoCall.toggleMic()"
        >
          <span class="zoom-ctrl-icon">{{ callState.audioEnabled ? '🎙' : '🔇' }}</span>
          <span class="zoom-ctrl-label">{{ callState.audioEnabled ? 'Микрофон' : 'Вкл. звук' }}</span>
        </button>

        <button
          type="button"
          class="zoom-ctrl-btn"
          :class="{ 'is-off': !callState.videoEnabled }"
          @click="VideoCall.toggleCam()"
        >
          <span class="zoom-ctrl-icon">{{ callState.videoEnabled ? '📹' : '🚫' }}</span>
          <span class="zoom-ctrl-label">{{ callState.videoEnabled ? 'Камера' : 'Вкл. видео' }}</span>
        </button>

        <button
          type="button"
          class="zoom-ctrl-btn"
          :class="{ 'is-active-share': callState.screenShareEnabled }"
          @click="VideoCall.toggleScreenShare()"
        >
          <span class="zoom-ctrl-icon">🖥</span>
          <span class="zoom-ctrl-label">{{ callState.screenShareEnabled ? 'Стоп экран' : 'Демо экрана' }}</span>
        </button>

        <button
          v-if="app.currentCallKey.value"
          type="button"
          class="zoom-ctrl-btn"
          @click="openInviteModal"
        >
          <span class="zoom-ctrl-icon">➕</span>
          <span class="zoom-ctrl-label">Пригласить</span>
        </button>

        <button type="button" class="zoom-ctrl-btn zoom-ctrl-leave" @click="leaveRoom">
          <span class="zoom-ctrl-icon">📞</span>
          <span class="zoom-ctrl-label">Завершить</span>
        </button>
      </footer>
    </div>

    <ShareLinkModal v-if="share" :link="share" title="Ссылка-приглашение на видеозвонок" @close="share = ''" />
  </section>
</template>

<script setup>
import { reactive, ref } from 'vue';
import BaseModal from './BaseModal.vue';
import CardFormModal from './CardFormModal.vue';
import { useLessonsStore } from '../../stores/lessonsStore';
const props = defineProps({ lesson: Object }); const emit = defineEmits(['close','saved']);
const store = useLessonsStore();
const form = reactive(JSON.parse(JSON.stringify(props.lesson || { title: '', teacherScript: '', studentScript: '', published: false, cards: [] })));
const error = ref(''), editIndex = ref(null), importing = ref(null);
function move(i,d) { const j = i+d; if(j<0||j>=form.cards.length) return; const [c] = form.cards.splice(i,1); form.cards.splice(j,0,c); }
function cardSave(card) { if(editIndex.value < 0) form.cards.push(card); else form.cards[editIndex.value] = card; return true; }
async function importJson(event) {
  try {
    const data = JSON.parse(await event.target.files[0].text()); const list = Array.isArray(data) ? data : data.cards || data.flashcards;
    if (!Array.isArray(list)) throw Error('Ожидается массив карточек.');
    const cards = list.map(c => ({ imageUrl: String(c.imageUrl || c.image || c.url || c.picture || '').trim(), text: String(c.text || c.english || c.en || c.word || '').trim(), translation: String(c.translation || c.russian || c.ru || c.translate || '').trim() }));
    const bad = cards.findIndex(c => !store.isValidUrl(c.imageUrl) || !c.text || !c.translation);
    if(bad >= 0) throw Error(`В карточке №${bad+1} нужны ссылка, английский текст и русский перевод. Импорт не выполнен.`);
    form.cards.push(...cards); error.value = '';
  } catch(e) { error.value = e.message; } finally { event.target.value = ''; }
}
async function submit() {
  if(!form.title.trim()) { error.value = 'Введите название урока.'; return; }
  if(form.cards.some(c => !c.translation?.trim() || !c.text?.trim() || !store.isValidUrl(c.imageUrl))) { error.value = 'Заполните ссылку, английский текст и русский перевод во всех карточках.'; return; }
  const saved = await store.saveLesson({ ...form, title: form.title.trim() }); if(saved) emit('saved',saved);
}
</script>
<template><BaseModal title="Материалы урока" wide :busy="store.isSaving.value" @close="!store.isSaving.value && emit('close')"><form @submit.prevent="submit"><div class="form-group"><label class="form-label">Название урока *</label><input v-model="form.title" class="form-input" required maxlength="140" /></div><label class="checkbox-card"><input v-model="form.published" type="checkbox" /><span>Опубликован · доступен ученикам</span></label><div class="scripts-grid"><div class="form-group"><label class="form-label">Скрипт учителя · Markdown</label><textarea v-model="form.teacherScript" class="form-textarea" rows="7" /></div><div class="form-group"><label class="form-label">Скрипт ученика · Markdown</label><textarea v-model="form.studentScript" class="form-textarea" rows="7" /></div></div><div class="section-row"><h3>Карточки ({{ form.cards.length }})</h3><div class="actions"><button class="btn btn-secondary btn-sm" type="button" @click="importing.click()">Импорт JSON</button><input ref="importing" hidden type="file" accept=".json,application/json" @change="importJson" /><button class="btn btn-primary btn-sm" type="button" @click="editIndex = -1">Добавить</button></div></div><div v-for="(card,i) in form.cards" :key="i" class="draft-card"><span>{{ i+1 }}. {{ card.text }}<small>{{ card.translation || 'Перевод не указан' }}</small></span><div class="actions"><button type="button" class="icon-btn" :disabled="i===0" aria-label="Выше" @click="move(i,-1)">↑</button><button type="button" class="icon-btn" :disabled="i===form.cards.length-1" aria-label="Ниже" @click="move(i,1)">↓</button><button type="button" class="icon-btn" aria-label="Изменить карточку" @click="editIndex=i">✎</button><button type="button" class="icon-btn danger" aria-label="Удалить карточку" @click="form.cards.splice(i,1)">✕</button></div></div><p class="form-error">{{ error }}</p><div class="modal-footer"><button class="btn btn-primary" :disabled="store.isSaving.value">{{ store.isSaving.value ? 'Сохраняем…' : 'Сохранить в облако' }}</button></div></form></BaseModal><CardFormModal v-if="editIndex !== null" :card="editIndex >= 0 ? form.cards[editIndex] : null" :action="cardSave" @close="editIndex=null" /></template>

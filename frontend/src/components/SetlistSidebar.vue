<script setup lang="ts">
import { ref, computed } from "vue";
import { useSetlistStore } from "../stores/setlistStore";

const props = defineProps<{
  currentTabId: string;
  currentTabTitle: string;
  currentTabArtist: string;
}>();

const emit = defineEmits<{
  navigateToTab: [tabId: string];
  close: [];
}>();

const setlistStore = useSetlistStore();

const newSetlistName = ref("");
const showCreateForm = ref(false);

function createSetlist() {
  if (!newSetlistName.value.trim()) return;
  const setlist = setlistStore.createSetlist(newSetlistName.value.trim());
  setlistStore.activeSetlistId = setlist.id;
  newSetlistName.value = "";
  showCreateForm.value = false;
}

function addCurrentTab() {
  if (!setlistStore.activeSetlistId) return;
  setlistStore.addToSetlist(
    setlistStore.activeSetlistId,
    props.currentTabId,
    props.currentTabTitle,
    props.currentTabArtist,
  );
}

function navigateToSong(index: number) {
  setlistStore.currentItemIndex = index;
  const item = setlistStore.activeSetlist?.items[index];
  if (item) {
    emit("navigateToTab", item.tabId);
  }
}

const setlistOptions = computed(() => setlistStore.setlists);
</script>

<template>
  <div class="setlist-sidebar">
    <div class="sidebar-header">
      <h3>Setlists</h3>
      <button class="close-btn" @click="emit('close')">×</button>
    </div>

    <!-- Setlist selector -->
    <div class="setlist-selector">
      <select v-model="setlistStore.activeSetlistId" class="setlist-select">
        <option :value="null">Select a setlist...</option>
        <option v-for="s in setlistOptions" :key="s.id" :value="s.id">
          {{ s.name }} ({{ s.items.length }})
        </option>
      </select>
      <button class="add-btn" @click="showCreateForm = !showCreateForm">+</button>
    </div>

    <!-- Create form -->
    <div v-if="showCreateForm" class="create-form">
      <input v-model="newSetlistName" placeholder="Setlist name..." @keyup.enter="createSetlist" />
      <button @click="createSetlist">Create</button>
    </div>

    <!-- Active setlist songs -->
    <div v-if="setlistStore.activeSetlist" class="song-list">
      <div
        v-for="(item, index) in setlistStore.activeSetlist.items"
        :key="item.id"
        class="song-item"
        :class="{ active: index === setlistStore.currentItemIndex }"
        @click="navigateToSong(index)"
      >
        <span class="song-number">{{ index + 1 }}</span>
        <div class="song-info">
          <div class="song-title">{{ item.title }}</div>
          <div class="song-artist">{{ item.artist }}</div>
        </div>
        <button class="remove-btn" @click.stop="setlistStore.removeFromSetlist(setlistStore.activeSetlistId!, item.id)">×</button>
      </div>

      <button class="add-current-btn" @click="addCurrentTab">
        + Add current tab
      </button>
    </div>

    <!-- Navigation -->
    <div v-if="setlistStore.activeSetlist" class="nav-buttons">
      <button :disabled="!setlistStore.hasPrev" @click="setlistStore.prevSong(); navigateToSong(setlistStore.currentItemIndex)">
        ← Previous
      </button>
      <button :disabled="!setlistStore.hasNext" @click="setlistStore.nextSong(); navigateToSong(setlistStore.currentItemIndex)">
        Next →
      </button>
    </div>
  </div>
</template>

<style scoped>
.setlist-sidebar {
  position: fixed;
  top: 0;
  right: 0;
  width: 320px;
  height: 100vh;
  background: #1a1a2e;
  color: #e0e0e0;
  border-left: 1px solid #2a2a4a;
  z-index: 1500;
  display: flex;
  flex-direction: column;
  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.3);
}

.sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid #2a2a4a;
}

.sidebar-header h3 {
  margin: 0;
  font-size: 18px;
}

.close-btn {
  background: none;
  border: none;
  color: #888;
  font-size: 24px;
  cursor: pointer;
  padding: 0 8px;
}

.setlist-selector {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid #2a2a4a;
}

.setlist-select {
  flex: 1;
  background: #16213e;
  color: #e0e0e0;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 8px;
}

.add-btn {
  background: #4a90d9;
  color: white;
  border: none;
  border-radius: 6px;
  width: 36px;
  font-size: 18px;
  cursor: pointer;
}

.create-form {
  display: flex;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid #2a2a4a;
}

.create-form input {
  flex: 1;
  background: #16213e;
  color: #e0e0e0;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 8px;
}

.create-form button {
  background: #4a90d9;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  cursor: pointer;
}

.song-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.song-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  min-height: 44px; /* Apple HIG touch target */
}

.song-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.song-item.active {
  background: rgba(74, 144, 217, 0.2);
  border-left: 3px solid #4a90d9;
}

.song-number {
  width: 28px;
  text-align: center;
  color: #666;
  font-size: 14px;
  flex-shrink: 0;
}

.song-info {
  flex: 1;
  min-width: 0;
}

.song-title {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.song-artist {
  font-size: 12px;
  color: #888;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.remove-btn {
  background: none;
  border: none;
  color: #666;
  font-size: 18px;
  cursor: pointer;
  padding: 0 8px;
  flex-shrink: 0;
}

.remove-btn:hover {
  color: #e74c3c;
}

.add-current-btn {
  display: block;
  width: calc(100% - 32px);
  margin: 8px 16px;
  padding: 12px;
  background: transparent;
  color: #4a90d9;
  border: 1px dashed #4a90d9;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.nav-buttons {
  display: flex;
  gap: 8px;
  padding: 16px;
  border-top: 1px solid #2a2a4a;
}

.nav-buttons button {
  flex: 1;
  padding: 12px;
  background: #16213e;
  color: #e0e0e0;
  border: 1px solid #333;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  min-height: 44px; /* Apple HIG */
}

.nav-buttons button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.nav-buttons button:not(:disabled):hover {
  background: #1e2d4a;
}
</style>

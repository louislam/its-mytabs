<script setup lang="ts">
import { ref } from "vue";
import { useChordScroll } from "../composables/useChordScroll";

const props = defineProps<{
  chordHtml: string;
  title?: string;
  artist?: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const scrollContainer = ref<HTMLElement | null>(null);
const { isScrolling, songDurationMs, toggle } = useChordScroll(scrollContainer);

// Convert ms to minutes:seconds for display
const durationMinutes = ref(3);
const durationSeconds = ref(0);

function updateDuration() {
  songDurationMs.value = (durationMinutes.value * 60 + durationSeconds.value) * 1000;
}
</script>

<template>
  <div class="chord-sheet-page">
    <div class="chord-header">
      <h1 v-if="title">{{ title }}</h1>
      <h2 v-if="artist">{{ artist }}</h2>
      <div class="chord-controls">
        <button class="scroll-btn" @click="toggle">
          {{ isScrolling ? "Stop" : "Scroll" }}
        </button>
        <label>
          Duration:
          <input type="number" v-model.number="durationMinutes" min="0" max="60" @change="updateDuration" />m
          <input type="number" v-model.number="durationSeconds" min="0" max="59" @change="updateDuration" />s
        </label>
        <button class="close-btn" @click="emit('close')">Back</button>
      </div>
    </div>
    <div class="chord-content" ref="scrollContainer" v-html="chordHtml"></div>
  </div>
</template>

<style scoped>
.chord-sheet-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #0a0a1a;
  color: #e0e0e0;
}

.chord-header {
  padding: 16px 24px;
  border-bottom: 1px solid #2a2a4a;
  flex-shrink: 0;
}

.chord-header h1 {
  font-size: 24px;
  margin: 0;
  text-align: center;
}

.chord-header h2 {
  font-size: 16px;
  margin: 4px 0 12px;
  text-align: center;
  color: #888;
}

.chord-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
}

.chord-controls label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
}

.chord-controls input {
  width: 50px;
  background: #16213e;
  color: #e0e0e0;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 4px 8px;
  text-align: center;
}

.scroll-btn,
.close-btn {
  padding: 8px 20px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
}

.scroll-btn {
  background: #4a90d9;
  color: white;
}

.close-btn {
  background: transparent;
  color: #999;
  border: 1px solid #333;
}

.chord-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  font-family: monospace;
  font-size: 16px;
  line-height: 1.8;
  white-space: pre-wrap;
}

/* Style the chord sheet HTML from chordsheetjs */
.chord-content :deep(.chord) {
  color: #5a9fd9;
  font-weight: bold;
}

.chord-content :deep(.lyrics) {
  color: #e0e0e0;
}

.chord-content :deep(.row) {
  display: flex;
  flex-wrap: wrap;
}

.chord-content :deep(.column) {
  display: inline-flex;
  flex-direction: column;
}
</style>

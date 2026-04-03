<script setup lang="ts">
import { ref } from "vue";
import { parseTextTab } from "../parsers/textTabParser";
import { parseUGContent, type ParsedUGContent } from "../parsers/ugParser";

const emit = defineEmits<{
  importTab: [alphaTex: string];
  importChords: [parsed: ParsedUGContent];
  close: [];
}>();

const activeTab = ref<"file" | "paste">("file");
const pastedContent = ref("");
const fileInput = ref<HTMLInputElement | null>(null);
const error = ref("");

function handleFileUpload(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  error.value = "";
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target?.result as string;
    try {
      const alphaTex = parseTextTab(text);
      emit("importTab", alphaTex);
    } catch (err) {
      error.value = "Could not parse tab file. Make sure it contains valid ASCII tablature.";
    }
  };
  reader.readAsText(file);
}

function handlePasteImport() {
  error.value = "";
  if (!pastedContent.value.trim()) {
    error.value = "Please paste tab content first.";
    return;
  }

  try {
    const parsed = parseUGContent(pastedContent.value);
    if (parsed.type === "tab" && parsed.alphaTex) {
      emit("importTab", parsed.alphaTex);
    } else if (parsed.type === "chords") {
      emit("importChords", parsed);
    }
  } catch (err) {
    error.value = "Could not parse the pasted content.";
  }
}
</script>

<template>
  <div class="import-overlay" @click.self="emit('close')">
    <div class="import-dialog">
      <h2>Import Tablature</h2>

      <div class="tab-buttons">
        <button :class="{ active: activeTab === 'file' }" @click="activeTab = 'file'">
          Text File
        </button>
        <button :class="{ active: activeTab === 'paste' }" @click="activeTab = 'paste'">
          Paste Content
        </button>
      </div>

      <div v-if="activeTab === 'file'" class="tab-content">
        <p>Upload a .txt file containing ASCII guitar tablature.</p>
        <input
          ref="fileInput"
          type="file"
          accept=".txt,.text"
          @change="handleFileUpload"
        />
      </div>

      <div v-if="activeTab === 'paste'" class="tab-content">
        <p>Paste tab content from Ultimate Guitar or any text source.</p>
        <textarea
          v-model="pastedContent"
          placeholder="Paste your tab or chord sheet here..."
          rows="12"
        />
        <button class="import-btn" @click="handlePasteImport">Import</button>
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <button class="close-btn" @click="emit('close')">Cancel</button>
    </div>
  </div>
</template>

<style scoped>
.import-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.import-dialog {
  background: #1a1a2e;
  color: #eee;
  border-radius: 12px;
  padding: 24px;
  width: 90%;
  max-width: 600px;
  max-height: 80vh;
  overflow-y: auto;
}

.import-dialog h2 {
  margin-top: 0;
  text-align: center;
}

.tab-buttons {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.tab-buttons button {
  flex: 1;
  padding: 12px;
  border: 1px solid #333;
  background: transparent;
  color: inherit;
  border-radius: 8px;
  font-size: 16px;
  cursor: pointer;
}

.tab-buttons button.active {
  background: #4a90d9;
  border-color: #4a90d9;
}

textarea {
  width: 100%;
  background: #16213e;
  color: inherit;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 12px;
  font-family: monospace;
  font-size: 14px;
  resize: vertical;
  box-sizing: border-box;
}

.import-btn,
.close-btn {
  padding: 12px 24px;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  cursor: pointer;
  margin-top: 12px;
  width: 100%;
}

.import-btn {
  background: #4a90d9;
  color: white;
}

.close-btn {
  background: transparent;
  color: #999;
  border: 1px solid #333;
}

.error {
  color: #e74c3c;
  margin-top: 8px;
}
</style>

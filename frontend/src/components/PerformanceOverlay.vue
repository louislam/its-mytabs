<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
    isPlaying: boolean;
    currentTick: number;
    endTick: number;
}>();

const emit = defineEmits<{
    togglePlay: [];
    exit: [];
}>();

const progress = computed(() =>
    props.endTick > 0 ? (props.currentTick / props.endTick) * 100 : 0
);
</script>

<template>
    <div class="performance-overlay">
        <!-- Thin progress bar at very top -->
        <div class="progress-bar">
            <div class="progress-fill" :style="{ width: progress + '%' }" />
        </div>

        <!-- Tap anywhere to toggle play/pause -->
        <div class="tap-zone" @click="emit('togglePlay')">
            <transition name="fade">
                <div v-if="!isPlaying" class="play-indicator">&#9654;</div>
            </transition>
        </div>

        <!-- Exit button (small, top-right corner) -->
        <button class="exit-btn" @click.stop="emit('exit')">EXIT</button>
    </div>
</template>

<style scoped>
.performance-overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
}

.progress-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: rgba(255, 255, 255, 0.1);
}

.progress-fill {
    height: 100%;
    background: #4a90d9;
    transition: width 0.3s linear;
}

.tap-zone {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
}

.play-indicator {
    font-size: 64px;
    color: rgba(255, 255, 255, 0.6);
    pointer-events: none;
}

.exit-btn {
    position: absolute;
    top: 12px;
    right: 12px;
    background: rgba(255, 255, 255, 0.15);
    color: rgba(255, 255, 255, 0.7);
    border: none;
    border-radius: 6px;
    padding: 8px 16px;
    font-size: 12px;
    letter-spacing: 1px;
    cursor: pointer;
    z-index: 1;
}

.exit-btn:hover {
    background: rgba(255, 255, 255, 0.25);
}

.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.3s;
}
.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}
</style>

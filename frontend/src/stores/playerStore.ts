import { defineStore } from "pinia";
import { ref } from "vue";

export const usePlayerStore = defineStore("player", () => {
    const isPlaying = ref<boolean>(false);
    const playbackSpeed = ref<number>(1.0);
    const currentTick = ref<number>(0);
    const totalTicks = ref<number>(0);
    const trackIndex = ref<number>(0);
    const trackCount = ref<number>(0);
    const cursorMode = ref<"none" | "highlight" | "follow">("follow");
    const scrollMode = ref<"continuous" | "offscreen">("continuous");
    const countIn = ref<boolean>(false);
    const metronome = ref<boolean>(false);
    const isLooping = ref<boolean>(false);

    return {
        isPlaying,
        playbackSpeed,
        currentTick,
        totalTicks,
        trackIndex,
        trackCount,
        cursorMode,
        scrollMode,
        countIn,
        metronome,
        isLooping,
    };
});

import { defineStore } from "pinia";
import { ref } from "vue";

export const useSettingsStore = defineStore("settings", () => {
    const darkMode = ref<boolean>(false);
    const performanceMode = ref<boolean>(false);
    const autoAdvance = ref<boolean>(false);
    const scrollSpeed = ref<number>(300);

    return {
        darkMode,
        performanceMode,
        autoAdvance,
        scrollSpeed,
    };
});

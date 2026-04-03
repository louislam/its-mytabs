import { computed, type Ref } from "vue";

const alphaTab = await import("@coderline/alphatab");
const { ScrollMode } = alphaTab;

export function useCursorMode(setting: Ref<Record<string, any>>) {
    const animatedCursor = computed(() => {
        return setting.value.cursor === "animated" || setting.value.scrollMode === ScrollMode.Smooth;
    });

    function applyCursorVisibility(playing: boolean) {
        // Hide the cursor when playing
        if (setting.value.cursor === "invisible" || setting.value.cursor === "bar") {
            const cursor = document.querySelector(".at-cursor-beat");
            if (cursor) {
                if (playing) {
                    console.log("Hide cursor");
                    cursor.classList.add("invisible");
                } else {
                    console.log("Show cursor");
                    cursor.classList.remove("invisible");
                }
            }
        }

        // Show the bar cursor if enabled
        if (setting.value.cursor === "bar") {
            const barCursor = document.querySelector(".at-cursor-bar");
            if (barCursor) {
                barCursor.classList.add("enable");
            }
        }
    }

    return { animatedCursor, applyCursorVisibility };
}

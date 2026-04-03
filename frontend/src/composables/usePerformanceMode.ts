import { ref } from "vue";
import { useWakeLock } from "./useWakeLock";

// Module-level singleton so performance mode state is shared across composable calls
const performanceMode = ref(false);

export function usePerformanceMode() {
    const wakeLock = useWakeLock();

    function enter() {
        performanceMode.value = true;
        // Fullscreen API not supported on iOS Safari — use CSS-based fullscreen instead
        document.documentElement.requestFullscreen?.().catch(() => {});
        // Orientation lock not supported on iOS Safari
        (screen.orientation as any)?.lock?.("landscape").catch(() => {});
        wakeLock.acquire();
    }

    function exit() {
        performanceMode.value = false;
        wakeLock.release();
        if (document.fullscreenElement) {
            document.exitFullscreen?.().catch(() => {});
        }
    }

    function toggle() {
        performanceMode.value ? exit() : enter();
    }

    return { performanceMode, enter, exit, toggle };
}

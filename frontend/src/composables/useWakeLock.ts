import { onBeforeUnmount } from "vue";
import { requestWakeLock, releaseWakeLock } from "../app.js";

export function useWakeLock() {
    let active = false;

    function acquire() {
        if (!active) {
            active = true;
            requestWakeLock();
        }
    }

    function release() {
        if (active) {
            active = false;
            releaseWakeLock();
        }
    }

    onBeforeUnmount(() => {
        release();
    });

    return { acquire, release };
}

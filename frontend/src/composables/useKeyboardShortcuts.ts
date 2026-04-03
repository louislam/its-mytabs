import { onMounted, onBeforeUnmount } from "vue";

export function useKeyboardShortcuts(handlers: {
    playPause: () => void;
    moveToBar: (steps: number) => void;
    playFromHighlightedRange: () => boolean | undefined;
    playFromFirstBarContainingNotes: (offset?: number) => void;
}) {
    const keyEvents = (e: KeyboardEvent) => {
        if (e.code === "Space") {
            e.preventDefault();
            handlers.playPause();
        } else if (e.code === "ArrowLeft") {
            e.preventDefault();
            handlers.moveToBar(-1);
        } else if (e.code === "ArrowRight") {
            e.preventDefault();
            handlers.moveToBar(1);
        } else if (e.code === "ArrowUp") {
            e.preventDefault();
            const result = handlers.playFromHighlightedRange();

            // Also act as the key S if not highlighted
            if (!result) {
                handlers.playFromFirstBarContainingNotes(-2);
            }
        } else if (e.code === "KeyS") {
            e.preventDefault();
            handlers.playFromFirstBarContainingNotes(-2);
        }
    };

    onMounted(() => {
        window.addEventListener("keydown", keyEvents);
    });

    onBeforeUnmount(() => {
        window.removeEventListener("keydown", keyEvents);
    });
}

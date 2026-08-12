import * as alphaTab from "@coderline/alphatab";

type Beat = alphaTab.model.Beat;
type AlphaTabApi = alphaTab.AlphaTabApi;
type PlaybackHighlightChangeEventArgs = alphaTab.PlaybackHighlightChangeEventArgs;
const PlayerState = alphaTab.synth.PlayerState;

/**
 * Internal alphaTab fields used to tell a plain click apart from a drag and to
 * compute repeat-aware ticks. They are not part of the public API, but are the
 * same internals the alphaTab maintainers' own selection-handle demo relies on.
 */
interface SelectionInternals {
    _selectionStart?: { beat: Beat; bounds?: unknown };
    _selectionEnd?: { beat: Beat; bounds?: unknown };
    _tickCache?: {
        getMasterBarStart(masterBar: unknown): number;
        getBeatStart(beat: Beat): number;
    };
    _currentBeat?: Beat | null;
    _player?: { state: alphaTab.synth.PlayerState };
}

export interface SelectionController {
    clear(): void;
    /** Whether the beat is inside the locked selection (all beats when unlocked). */
    isWithinSelection(beat: Beat): boolean;
}

type DragType = "start" | "end";

function getRelativePosition(parent: HTMLElement, e: MouseEvent | PointerEvent) {
    const parentPos = parent.getBoundingClientRect();
    const parentLeft = parentPos.left + parent.ownerDocument.defaultView.pageXOffset;
    const parentTop = parentPos.top + parent.ownerDocument.defaultView.pageYOffset;
    return {
        relX: e.pageX - parentLeft,
        relY: e.pageY - parentTop,
    };
}

/**
 * Find the beat under the pointer. Mirrors the alphaTab playground example:
 * only snap to a beat when the pointer is over its whitespace area so the
 * handles feel like they grab the beat boundary.
 */
function getBeatFromEvent(container: HTMLElement, api: AlphaTabApi, e: MouseEvent | PointerEvent): Beat | undefined {
    const { relX, relY } = getRelativePosition(container, e);
    const beat = api.boundsLookup?.getBeatAtPos(relX, relY);
    if (!beat) {
        return undefined;
    }
    const bounds = api.boundsLookup!.findBeat(beat);
    if (!bounds) {
        return undefined;
    }
    const visualBoundsEnd = bounds.visualBounds.x + bounds.visualBounds.w;
    const realBoundsEnd = bounds.realBounds.x + bounds.realBounds.w;
    if (relX < visualBoundsEnd || relX > realBoundsEnd) {
        return undefined;
    }
    return beat;
}

function getBeatTick(api: AlphaTabApi, beat: Beat): number {
    const internal = api as unknown as SelectionInternals;
    const tickCache = internal._tickCache;
    const masterBar = beat.voice?.bar?.masterBar;
    if (tickCache?.getMasterBarStart && masterBar) {
        return tickCache.getMasterBarStart(masterBar) + beat.playbackStart;
    }
    return beat.absolutePlaybackStart;
}

/** Whether `beat` falls within the selection [startTick, endTick). */
function isInsideSelection(api: AlphaTabApi, start: Beat, end: Beat, beat: Beat): boolean {
    const tick = getBeatTick(api, beat);
    const startTick = getBeatTick(api, start);
    const endTick = getBeatTick(api, end) + end.playbackDuration;
    return tick >= startTick && tick < endTick;
}

/**
 * Selection UI for the AlphaTab score:
 * - Once a range is selected it is locked: dragging the score can no longer
 *   replace it, and a plain click only seeks the cursor without clearing it.
 * - Start/end drag handles at the highlight edges expand the locked range.
 * - A close button (top-right of the last bar) is the only way to clear it.
 */
export function setupSelection(container: HTMLElement, api: AlphaTabApi): SelectionController {
    const wrapper = document.createElement("div");
    wrapper.className = "at-selection-handles";

    const startHandle = document.createElement("div");
    startHandle.className = "at-selection-handle at-selection-handle-start";
    wrapper.appendChild(startHandle);

    const endHandle = document.createElement("div");
    endHandle.className = "at-selection-handle at-selection-handle-end";
    wrapper.appendChild(endHandle);

    const closeButton = document.createElement("div");
    closeButton.className = "at-selection-close";
    wrapper.appendChild(closeButton);

    container.appendChild(wrapper);

    const originalApply = api.applyPlaybackRangeFromHighlight.bind(api);

    /** The locked selection that must not be replaced by a new score drag. */
    let lockedStart: Beat | undefined;
    let lockedEnd: Beat | undefined;
    let isLocked = false;
    /** True while a mouse gesture on the score (down..up) is in progress. */
    let isScoreDrag = false;
    let dragging: DragType | undefined;

    function sameBeat(a: Beat, b: Beat): boolean {
        return (
            a === b ||
            (a.voice?.bar?.index === b.voice?.bar?.index &&
                a.index === b.index &&
                a.absolutePlaybackStart === b.absolutePlaybackStart)
        );
    }

    function lockSelection(start: Beat, end: Beat) {
        lockedStart = start;
        lockedEnd = end;
        isLocked = true;
    }

    function unlockSelection() {
        lockedStart = undefined;
        lockedEnd = undefined;
        isLocked = false;
    }

    function hideHandles() {
        startHandle.classList.remove("active");
        endHandle.classList.remove("active");
        closeButton.classList.remove("active");
    }

    function positionHandles(e: PlaybackHighlightChangeEventArgs) {
        if (!e.startBeat || !e.endBeat || !e.startBeatBounds || !e.endBeatBounds) {
            hideHandles();
            return;
        }

        const startBounds = e.startBeatBounds;
        const endBounds = e.endBeatBounds;

        // Replicate alphaTab's own start/end X logic so the handles line up
        // exactly with the edges of the rendered highlight (bar-edge for the
        // first/last beat of a bar, beat-edge otherwise).
        const startX =
            startBounds.beat.index === 0
                ? startBounds.barBounds.masterBarBounds.realBounds.x
                : startBounds.realBounds.x;
        const endX =
            endBounds.beat.index === endBounds.beat.voice.beats.length - 1
                ? endBounds.barBounds.masterBarBounds.realBounds.x + endBounds.barBounds.masterBarBounds.realBounds.w
                : endBounds.realBounds.x + endBounds.realBounds.w;
        const barTop = endBounds.barBounds.masterBarBounds.visualBounds.y;
        const barHeight = endBounds.barBounds.masterBarBounds.visualBounds.h;

        startHandle.classList.add("active");
        startHandle.style.left = `${startX}px`;
        startHandle.style.top = `${startBounds.barBounds.masterBarBounds.visualBounds.y}px`;
        startHandle.style.height = `${startBounds.barBounds.masterBarBounds.visualBounds.h}px`;

        endHandle.classList.add("active");
        endHandle.style.left = `${endX}px`;
        endHandle.style.top = `${barTop}px`;
        endHandle.style.height = `${barHeight}px`;

        closeButton.classList.add("active");
        closeButton.style.left = `${endX - 26}px`;
        closeButton.style.top = `${barTop - 28}px`;
    }

    function onHighlightChanged(e: PlaybackHighlightChangeEventArgs) {
        const hasSelection = !!e.startBeat && !!e.endBeat;

        if (isScoreDrag) {
            if (isLocked) {
                // A locked selection is frozen: cancel any drag preview so the
                // committed highlight stays put while dragging over the score.
                if (!hasSelection || !sameBeat(e.startBeat!, lockedStart!) || !sameBeat(e.endBeat!, lockedEnd!)) {
                    api.highlightPlaybackRange(lockedStart!, lockedEnd!);
                }
                return;
            }
            // Fresh (not yet committed) selection preview from a score drag
            if (hasSelection) {
                lockedStart = e.startBeat;
                lockedEnd = e.endBeat;
            }
            positionHandles(e);
            return;
        }

        // Handle drags, programmatic ranges and commits
        if (hasSelection) {
            lockSelection(e.startBeat!, e.endBeat!);
        } else {
            unlockSelection();
        }
        positionHandles(e);
    }

    api.playbackRangeHighlightChanged.on(onHighlightChanged);

    function onBeatMouseDown() {
        isScoreDrag = true;
    }
    function onBeatMouseUp() {
        isScoreDrag = false;
    }
    api.beatMouseDown.on(onBeatMouseDown);
    api.beatMouseUp.on(onBeatMouseUp);

    /**
     * Wrap alphaTab's selection commit:
     * - A locked selection can never be replaced by dragging the score.
     * - Dragging the handles still expands the locked range.
     * - A plain click only seeks and keeps the locked selection.
     */
    api.applyPlaybackRangeFromHighlight = function (this: AlphaTabApi) {
        const internal = this as unknown as SelectionInternals;
        const start = internal._selectionStart;
        const end = internal._selectionEnd;
        const isDrag = !!start && !!end && start.beat !== end.beat;

        if (isDrag) {
            if (dragging !== undefined) {
                // Handle drag: commit the expanded range and keep it locked
                originalApply();
                lockSelection(internal._selectionStart!.beat, internal._selectionEnd!.beat);
                return;
            }
            if (isLocked) {
                // Score drag with a locked selection: keep the range, only make
                // sure the highlight is still the locked one.
                this.highlightPlaybackRange(lockedStart!, lockedEnd!);
                return;
            }
            // Fresh selection from a score drag
            originalApply();
            lockSelection(internal._selectionStart!.beat, internal._selectionEnd!.beat);
            return;
        }

        // Plain click (or zero-length drag): seek only, never clear.
        if (start?.beat) {
            if (isLocked && lockedStart && lockedEnd && !isInsideSelection(this, lockedStart, lockedEnd, start.beat)) {
                // Clicked outside the locked range: ignore it, keep the selection.
                this.highlightPlaybackRange(lockedStart, lockedEnd);
                return;
            }
            internal._currentBeat = null;
            const tickCache = internal._tickCache;
            if (internal._player?.state === PlayerState.Paused && tickCache) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (internal as any)._cursorUpdateTick?.(tickCache.getBeatStart(start.beat), false, 1);
            }
            this.tickPosition = getBeatTick(this, start.beat);
        }
        if (isLocked && lockedStart && lockedEnd) {
            this.highlightPlaybackRange(lockedStart, lockedEnd);
        }
    };

    function onPointerDown(type: DragType, e: PointerEvent) {
        e.preventDefault();
        dragging = type;
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        document.body.classList.add("at-selection-handle-drag");
    }

    function onPointerMove(e: PointerEvent) {
        if (!dragging) {
            return;
        }
        e.preventDefault();
        if (!isLocked || !lockedStart || !lockedEnd) {
            return;
        }
        const beat = getBeatFromEvent(container, api, e);
        if (!beat) {
            return;
        }
        if (dragging === "start") {
            api.highlightPlaybackRange(beat, lockedEnd);
        } else {
            api.highlightPlaybackRange(lockedStart, beat);
        }
    }

    function onPointerUp(e: PointerEvent) {
        if (!dragging) {
            return;
        }
        e.preventDefault();
        // Commit before clearing the drag flag so the wrapped
        // applyPlaybackRangeFromHighlight still sees it as a handle drag.
        api.applyPlaybackRangeFromHighlight();
        dragging = undefined;
        document.body.classList.remove("at-selection-handle-drag");
    }

    for (const [handle, type] of [
        [startHandle, "start"],
        [endHandle, "end"],
    ] as const) {
        handle.addEventListener("pointerdown", (e) => onPointerDown(type, e));
        handle.addEventListener("pointermove", onPointerMove);
        handle.addEventListener("pointerup", onPointerUp);
        handle.addEventListener("pointercancel", onPointerUp);
    }

    closeButton.addEventListener("pointerdown", (e) => e.preventDefault());
    closeButton.addEventListener("click", () => {
        unlockSelection();
        api.playbackRange = null;
        api.clearPlaybackRangeHighlight();
    });

    return {
        isWithinSelection(beat: Beat): boolean {
            if (!isLocked || !lockedStart || !lockedEnd) {
                return true;
            }
            return isInsideSelection(api, lockedStart, lockedEnd, beat);
        },
        clear() {
            api.playbackRangeHighlightChanged.off(onHighlightChanged);
            api.beatMouseDown.off(onBeatMouseDown);
            api.beatMouseUp.off(onBeatMouseUp);
            api.applyPlaybackRangeFromHighlight = originalApply;
            document.body.classList.remove("at-selection-handle-drag");
            wrapper.remove();
        },
    };
}

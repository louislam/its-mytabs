import { ref, onUnmounted, type Ref } from "vue";

export function useChordScroll(scrollContainer: Ref<HTMLElement | null>) {
  const isScrolling = ref(false);
  const songDurationMs = ref(180_000); // default 3 minutes
  let animationId: number | null = null;
  let startTime: number | null = null;
  let startScrollTop = 0;

  function start() {
    if (!scrollContainer.value) return;
    isScrolling.value = true;
    startScrollTop = scrollContainer.value.scrollTop;
    startTime = performance.now();
    tick();
  }

  function tick() {
    if (!isScrolling.value || !scrollContainer.value || !startTime) return;

    const elapsed = performance.now() - startTime;
    const progress = elapsed / songDurationMs.value;
    const totalScroll = scrollContainer.value.scrollHeight - scrollContainer.value.clientHeight;
    scrollContainer.value.scrollTop = startScrollTop + (totalScroll - startScrollTop) * progress;

    if (progress < 1) {
      animationId = requestAnimationFrame(tick);
    } else {
      isScrolling.value = false;
    }
  }

  function stop() {
    isScrolling.value = false;
    if (animationId) cancelAnimationFrame(animationId);
  }

  function toggle() {
    isScrolling.value ? stop() : start();
  }

  onUnmounted(stop);

  return { isScrolling, songDurationMs, start, stop, toggle };
}

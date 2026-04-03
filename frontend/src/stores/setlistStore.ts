import { defineStore } from "pinia";
import { ref, computed } from "vue";

export interface SetlistItem {
  id: string;
  tabId: string;
  title: string;
  artist: string;
  order: number;
}

export interface Setlist {
  id: string;
  name: string;
  items: SetlistItem[];
  createdAt: string;
}

export const useSetlistStore = defineStore("setlist", () => {
  const setlists = ref<Setlist[]>([]);
  const activeSetlistId = ref<string | null>(null);
  const currentItemIndex = ref(0);

  const activeSetlist = computed(() =>
    setlists.value.find(s => s.id === activeSetlistId.value) ?? null
  );

  const currentItem = computed(() =>
    activeSetlist.value?.items[currentItemIndex.value] ?? null
  );

  const hasNext = computed(() =>
    activeSetlist.value ? currentItemIndex.value < activeSetlist.value.items.length - 1 : false
  );

  const hasPrev = computed(() => currentItemIndex.value > 0);

  function createSetlist(name: string): Setlist {
    const setlist: Setlist = {
      id: crypto.randomUUID(),
      name,
      items: [],
      createdAt: new Date().toISOString(),
    };
    setlists.value.push(setlist);
    saveToStorage();
    return setlist;
  }

  function deleteSetlist(setlistId: string) {
    setlists.value = setlists.value.filter(s => s.id !== setlistId);
    if (activeSetlistId.value === setlistId) {
      activeSetlistId.value = null;
    }
    saveToStorage();
  }

  function addToSetlist(setlistId: string, tabId: string, title: string, artist: string) {
    const setlist = setlists.value.find(s => s.id === setlistId);
    if (!setlist) return;
    setlist.items.push({
      id: crypto.randomUUID(),
      tabId,
      title,
      artist,
      order: setlist.items.length,
    });
    saveToStorage();
  }

  function removeFromSetlist(setlistId: string, itemId: string) {
    const setlist = setlists.value.find(s => s.id === setlistId);
    if (!setlist) return;
    setlist.items = setlist.items.filter(i => i.id !== itemId);
    setlist.items.forEach((item, idx) => { item.order = idx; });
    saveToStorage();
  }

  function reorderSetlist(setlistId: string, fromIndex: number, toIndex: number) {
    const setlist = setlists.value.find(s => s.id === setlistId);
    if (!setlist) return;
    const [item] = setlist.items.splice(fromIndex, 1);
    setlist.items.splice(toIndex, 0, item);
    setlist.items.forEach((item, idx) => { item.order = idx; });
    saveToStorage();
  }

  function nextSong() {
    if (hasNext.value) currentItemIndex.value++;
  }

  function prevSong() {
    if (hasPrev.value) currentItemIndex.value--;
  }

  // Persist to localStorage (backend persistence in Task 4.4)
  function saveToStorage() {
    localStorage.setItem("gigtab-setlists", JSON.stringify(setlists.value));
  }

  function loadFromStorage() {
    const saved = localStorage.getItem("gigtab-setlists");
    if (saved) {
      try {
        setlists.value = JSON.parse(saved);
      } catch (e) {
        console.error("Failed to load setlists:", e);
      }
    }
  }

  // Load on init
  loadFromStorage();

  return {
    setlists, activeSetlistId, currentItemIndex,
    activeSetlist, currentItem, hasNext, hasPrev,
    createSetlist, deleteSetlist, addToSetlist, removeFromSetlist, reorderSetlist,
    nextSong, prevSong, loadFromStorage,
  };
});

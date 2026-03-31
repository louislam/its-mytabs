<script>
import { defineComponent } from "vue";
import { notify } from "@kyvg/vue3-notification";
import { baseURL, checkFetch, generalError } from "../app.js";

export default defineComponent({
    data() {
        return {
            playlistId: "",
            playlist: null,
            tabs: [],
            ready: false,
            editingName: false,
            editName: "",
            showAddTabs: false,
            allTabs: [],
            addSearchQuery: "",
            dragIndex: null,
        };
    },

    async mounted() {
        this.playlistId = this.$route.params.id;
        await this.load();
    },

    computed: {
        filteredAddTabs() {
            const existingIds = new Set(this.playlist?.tabIds || []);
            let available = this.allTabs.filter((tab) => !existingIds.has(tab.id));

            if (this.addSearchQuery.trim()) {
                const query = this.addSearchQuery.trim().toLowerCase();
                available = available.filter((tab) => {
                    return (tab.title || "").toLowerCase().includes(query) ||
                        (tab.artist || "").toLowerCase().includes(query);
                });
            }

            return available;
        },
    },

    methods: {
        async load() {
            try {
                const res = await fetch(baseURL + `/api/playlist/${this.playlistId}`, {
                    credentials: "include",
                });
                await checkFetch(res);
                const data = await res.json();
                this.playlist = data.playlist;
                this.tabs = data.tabs;
                this.ready = true;
            } catch (e) {
                generalError(e);
            }
        },

        startEditName() {
            this.editName = this.playlist.name;
            this.editingName = true;
            this.$nextTick(() => {
                this.$refs.nameInput?.focus();
            });
        },

        async saveName() {
            try {
                const res = await fetch(baseURL + `/api/playlist/${this.playlistId}`, {
                    method: "PUT",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: this.editName }),
                });
                await checkFetch(res);
                this.playlist.name = this.editName;
                this.editingName = false;
            } catch (e) {
                generalError(e);
            }
        },

        cancelEditName() {
            this.editingName = false;
        },

        async removeTab(tabId) {
            try {
                const res = await fetch(baseURL + `/api/playlist/${this.playlistId}/tab/${tabId}`, {
                    method: "DELETE",
                    credentials: "include",
                });
                await checkFetch(res);
                this.playlist.tabIds = this.playlist.tabIds.filter((id) => id !== tabId);
                this.tabs = this.tabs.filter((tab) => tab.id !== tabId);
            } catch (e) {
                generalError(e);
            }
        },

        async openAddTabs() {
            this.showAddTabs = true;
            this.addSearchQuery = "";

            // Fetch all tabs if not loaded
            if (this.allTabs.length === 0) {
                try {
                    const res = await fetch(baseURL + "/api/tabs", { credentials: "include" });
                    await checkFetch(res);
                    const data = await res.json();
                    this.allTabs = data.tabs;
                } catch (e) {
                    generalError(e);
                }
            }
        },

        async addTab(tab) {
            try {
                const res = await fetch(baseURL + `/api/playlist/${this.playlistId}/tab/${tab.id}`, {
                    method: "POST",
                    credentials: "include",
                });
                await checkFetch(res);
                this.playlist.tabIds.push(tab.id);
                this.tabs.push(tab);
                notify({ text: `Added "${tab.title}"`, type: "success" });
            } catch (e) {
                generalError(e);
            }
        },

        // Drag-to-reorder
        onDragStart(index, event) {
            this.dragIndex = index;
            event.dataTransfer.effectAllowed = "move";
        },

        onDragOver(index, event) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
        },

        async onDrop(targetIndex) {
            if (this.dragIndex === null || this.dragIndex === targetIndex) {
                this.dragIndex = null;
                return;
            }

            // Reorder tabs array
            const movedTab = this.tabs.splice(this.dragIndex, 1)[0];
            this.tabs.splice(targetIndex, 0, movedTab);

            // Reorder tabIds
            const movedId = this.playlist.tabIds.splice(this.dragIndex, 1)[0];
            this.playlist.tabIds.splice(targetIndex, 0, movedId);

            this.dragIndex = null;

            // Save new order
            try {
                const res = await fetch(baseURL + `/api/playlist/${this.playlistId}`, {
                    method: "PUT",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ tabIds: this.playlist.tabIds }),
                });
                await checkFetch(res);
            } catch (e) {
                generalError(e);
            }
        },

        onDragEnd() {
            this.dragIndex = null;
        },

        playFromPlaylist(tabId) {
            this.$router.push(`/tab/${tabId}?playlist=${this.playlistId}`);
        },
    },
});
</script>

<template>
    <div class="container my-container" v-if="ready">
        <div class="mt-4 mb-3">
            <router-link to="/" class="btn btn-outline-secondary btn-sm">
                <font-awesome-icon :icon='["fas", "arrow-left"]' />
                Back
            </router-link>
        </div>

        <!-- Playlist name -->
        <div class="mb-4">
            <div v-if="!editingName" class="d-flex align-items-center gap-2">
                <h2 class="mb-0">{{ playlist.name }}</h2>
                <button class="btn btn-sm btn-outline-secondary" @click="startEditName">Rename</button>
            </div>
            <div v-else class="d-flex align-items-center gap-2">
                <input
                    ref="nameInput"
                    type="text"
                    class="form-control"
                    v-model="editName"
                    @keyup.enter="saveName"
                    @keyup.escape="cancelEditName"
                    style="max-width: 400px"
                />
                <button class="btn btn-sm btn-primary" @click="saveName">Save</button>
                <button class="btn btn-sm btn-outline-secondary" @click="cancelEditName">Cancel</button>
            </div>
        </div>

        <div class="mb-3 text-muted">{{ tabs.length }} tab(s)</div>

        <!-- Tabs list (drag-to-reorder) -->
        <div class="playlist-tabs">
            <div
                v-for="(tab, index) in tabs"
                :key="tab.id"
                class="playlist-tab-item p-3 rounded d-flex align-items-center"
                :class='{ "drag-over": dragIndex !== null && dragIndex !== index }'
                draggable="true"
                @dragstart="onDragStart(index, $event)"
                @dragover="onDragOver(index, $event)"
                @drop="onDrop(index)"
                @dragend="onDragEnd"
            >
                <div class="drag-handle me-3">
                    <font-awesome-icon :icon='["fas", "grip-vertical"]' />
                </div>

                <div class="tab-number me-3">{{ index + 1 }}</div>

                <div class="info flex-grow-1" @click="playFromPlaylist(tab.id)" role="button">
                    <div class="title">{{ tab.title }}</div>
                    <div class="artist text-muted">{{ tab.artist }}</div>
                </div>

                <button class="btn btn-sm btn-primary me-2" @click="playFromPlaylist(tab.id)">
                    <font-awesome-icon :icon='["fas", "play"]' />
                </button>

                <button class="btn btn-sm btn-outline-danger" @click="removeTab(tab.id)">
                    Remove
                </button>
            </div>
        </div>

        <!-- Empty state -->
        <div v-if="tabs.length === 0" class="text-center py-5 text-muted">
            <p>This playlist is empty. Add some tabs to get started.</p>
        </div>

        <!-- Add tabs -->
        <div class="mt-4 mb-5">
            <button class="btn btn-outline-primary" @click="openAddTabs" v-if="!showAddTabs">
                <font-awesome-icon :icon='["fas", "plus"]' />
                Add Tabs
            </button>

            <div v-if="showAddTabs" class="add-tabs-panel p-3 rounded">
                <div class="d-flex align-items-center justify-content-between mb-3">
                    <strong>Add tabs to playlist</strong>
                    <button class="btn btn-sm btn-outline-secondary" @click="showAddTabs = false">Close</button>
                </div>

                <input
                    type="text"
                    class="form-control mb-3"
                    v-model="addSearchQuery"
                    placeholder="Search tabs..."
                />

                <div class="add-tabs-list">
                    <div
                        v-for="tab in filteredAddTabs"
                        :key="tab.id"
                        class="add-tab-item d-flex align-items-center p-2 rounded"
                    >
                        <div class="flex-grow-1">
                            <div>{{ tab.title }}</div>
                            <small class="text-muted">{{ tab.artist }}</small>
                        </div>
                        <button class="btn btn-sm btn-outline-primary" @click="addTab(tab)">
                            Add
                        </button>
                    </div>

                    <div v-if="filteredAddTabs.length === 0" class="text-muted text-center p-3">
                        No tabs available to add
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped lang="scss">
@import "../styles/vars.scss";

.playlist-tab-item {
    border-bottom: 1px solid #333;
    transition: background-color 0.15s;
    cursor: default;

    &:hover {
        background-color: rgba(255, 255, 255, 0.03);
    }

    .drag-handle {
        cursor: grab;
        color: #666;
        font-size: 18px;
        padding: 8px;
        touch-action: none;

        &:active {
            cursor: grabbing;
        }
    }

    .tab-number {
        color: #888;
        font-size: 14px;
        min-width: 24px;
        text-align: center;
    }

    .info {
        .title {
            font-size: 16px;
        }
        .artist {
            font-size: 13px;
        }
    }
}

.add-tabs-panel {
    border: 1px solid #444;
    background-color: #2a2e33;
    max-height: 400px;
    overflow-y: auto;
}

.add-tab-item {
    border-bottom: 1px solid #333;

    &:hover {
        background-color: rgba(255, 255, 255, 0.05);
    }

    &:last-child {
        border-bottom: none;
    }
}
</style>

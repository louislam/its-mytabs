<script>
import { defineComponent } from "vue";
import { notify } from "@kyvg/vue3-notification";
import { baseURL, getSetting } from "../app.js";
import { isLoggedIn } from "../auth-client.js";
import TabItem from "../components/TabItem.vue";

export default defineComponent({
    components: {
        TabItem,
    },

    data() {
        return {
            tabList: [],
            playlists: [],
            ready: false,
            isLoggedIn: false,
            searchQuery: "",
            setting: {},
            selectedTagFilter: "",
            selectMode: false,
            selectedTabIds: [],
        };
    },

    async mounted() {
        this.isLoggedIn = await isLoggedIn();
        this.setting = getSetting();

        if (!this.isLoggedIn) {
            this.$router.push("/login");
            return;
        }

        try {
            const [tabRes, playlistRes] = await Promise.all([
                fetch(baseURL + "/api/tabs", { credentials: "include" }),
                fetch(baseURL + "/api/playlists", { credentials: "include" }),
            ]);
            const tabData = await tabRes.json();
            this.tabList = tabData.tabs;

            const playlistData = await playlistRes.json();
            this.playlists = playlistData.playlists || [];

            this.ready = true;

            await this.$nextTick();
            this.$refs.searchInput?.focus();
        } catch (error) {
            notify({
                text: error.message,
                type: "error",
            });
        }
    },

    computed: {
        sortedTabList() {
            const tabs = [...this.tabList];
            const sortBy = this.setting.tabSortBy || "dateNewest";

            switch (sortBy) {
                case "title":
                    tabs.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
                    break;
                case "artist":
                    tabs.sort((a, b) => (a.artist || "").localeCompare(b.artist || ""));
                    break;
                case "dateOldest":
                    tabs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
                    break;
                case "dateNewest":
                default:
                    tabs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                    break;
            }

            return tabs;
        },

        filteredTabList() {
            let tabs = this.sortedTabList;

            // Filter by search query
            if (this.searchQuery.trim()) {
                const query = this.searchQuery.trim().toLowerCase();
                tabs = tabs.filter((tab) => {
                    const title = (tab.title || "").toLowerCase();
                    const artist = (tab.artist || "").toLowerCase();
                    return title.includes(query) || artist.includes(query);
                });
            }

            // Filter by tag
            if (this.selectedTagFilter) {
                tabs = tabs.filter((tab) => (tab.tags || []).includes(this.selectedTagFilter));
            }

            return tabs;
        },

        allTags() {
            const tagSet = new Set();
            for (const tab of this.tabList) {
                for (const tag of (tab.tags || [])) {
                    tagSet.add(tag);
                }
            }
            return [...tagSet].sort();
        },

        favoritedTabs() {
            return this.tabList.filter((tab) => tab.fav);
        },

        groupedTabs() {
            const groups = {};

            for (const tab of this.filteredTabList) {
                const rawArtist = tab.artist || "Unknown Artist";

                // Normalize for grouping (ignore case + trim)
                const key = rawArtist.trim().toLowerCase();

                if (!groups[key]) {
                    groups[key] = {
                        displayName: rawArtist.trim() || "Unknown Artist",
                        tabs: [],
                    };
                }

                groups[key].tabs.push(tab);
            }

            // Sort artists alphabetically
            const sortedArtists = Object.values(groups).sort((a, b) => a.displayName.localeCompare(b.displayName));

            // Sort songs alphabetically inside each artist
            sortedArtists.forEach((group) => {
                group.tabs.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
            });

            return sortedArtists;
        },
    },

    methods: {
        handleFavToggled() {
            // Force re-render by creating a new array reference
            this.tabList = [...this.tabList];
        },

        toggleSelectMode() {
            this.selectMode = !this.selectMode;
            if (!this.selectMode) {
                this.selectedTabIds = [];
            }
        },

        toggleTabSelection(id) {
            const idx = this.selectedTabIds.indexOf(id);
            if (idx >= 0) {
                this.selectedTabIds.splice(idx, 1);
            } else {
                this.selectedTabIds.push(id);
            }
        },

        selectAll() {
            this.selectedTabIds = this.filteredTabList.map((tab) => tab.id);
        },

        deselectAll() {
            this.selectedTabIds = [];
        },

        async bulkDelete() {
            if (this.selectedTabIds.length === 0) return;
            if (!confirm(`Are you sure you want to delete ${this.selectedTabIds.length} tab(s)?`)) return;

            let deleted = 0;
            for (const id of this.selectedTabIds) {
                try {
                    const res = await fetch(baseURL + `/api/tab/${id}`, {
                        method: "DELETE",
                        credentials: "include",
                    });
                    if (res.status === 200) {
                        deleted++;
                    }
                } catch (error) {
                    console.error(`Failed to delete tab ${id}:`, error);
                }
            }

            this.tabList = this.tabList.filter((tab) => !this.selectedTabIds.includes(tab.id));
            this.selectedTabIds = [];

            notify({
                text: `Deleted ${deleted} tab(s)`,
                type: "success",
            });
        },

        filterByTag(tag) {
            if (this.selectedTagFilter === tag) {
                this.selectedTagFilter = "";
            } else {
                this.selectedTagFilter = tag;
            }
        },

        async createPlaylist() {
            const name = prompt("Playlist name:");
            if (!name || !name.trim()) return;

            try {
                const res = await fetch(baseURL + "/api/playlist", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: name.trim() }),
                });
                const data = await res.json();
                if (data.playlist) {
                    this.playlists.unshift(data.playlist);
                    notify({ text: "Playlist created", type: "success" });
                }
            } catch (error) {
                notify({ text: error.message, type: "error" });
            }
        },

        async deletePlaylist(id, name) {
            if (!confirm(`Delete playlist "${name}"?`)) return;

            try {
                const res = await fetch(baseURL + `/api/playlist/${id}`, {
                    method: "DELETE",
                    credentials: "include",
                });
                if (res.ok) {
                    this.playlists = this.playlists.filter((p) => p.id !== id);
                    notify({ text: "Playlist deleted", type: "success" });
                }
            } catch (error) {
                notify({ text: error.message, type: "error" });
            }
        },

        async bulkAddToPlaylist() {
            if (this.selectedTabIds.length === 0) return;
            if (this.playlists.length === 0) {
                notify({ text: "Create a playlist first", type: "error" });
                return;
            }

            const names = this.playlists.map((p) => p.name);
            const choice = prompt(`Add ${this.selectedTabIds.length} tab(s) to which playlist?\n\n${names.map((n, i) => `${i + 1}. ${n}`).join("\n")}\n\nEnter number:`);
            if (!choice) return;

            const idx = parseInt(choice) - 1;
            if (isNaN(idx) || idx < 0 || idx >= this.playlists.length) {
                notify({ text: "Invalid selection", type: "error" });
                return;
            }

            const playlist = this.playlists[idx];
            let added = 0;
            for (const tabId of this.selectedTabIds) {
                try {
                    await fetch(baseURL + `/api/playlist/${playlist.id}/tab/${tabId}`, {
                        method: "POST",
                        credentials: "include",
                    });
                    added++;
                } catch {
                    // skip
                }
            }

            notify({ text: `Added ${added} tab(s) to "${playlist.name}"`, type: "success" });
            this.selectedTabIds = [];
        },

        async deleteTab(id, title, artist) {
            if (!confirm(`Are you sure you want to delete ${artist} - ${title}?`)) return;

            try {
                const res = await fetch(baseURL + `/api/tab/${id}`, {
                    method: "DELETE",
                    credentials: "include",
                });

                if (res.status === 200) {
                    this.tabList = this.tabList.filter((tab) => tab.id !== id);

                    notify({
                        text: "Tab deleted successfully",
                        type: "success",
                    });
                } else {
                    const data = await res.json();
                    throw new Error(data.message || "Failed to delete tab");
                }
            } catch (error) {
                notify({
                    text: error.message,
                    type: "error",
                });
            }
        },
    },
});
</script>

<template>
    <div class="container my-container">
        <!-- Playlists Section -->
        <div class="playlists-section ms-3 me-3 mt-3 mb-3" v-if="ready && (playlists.length > 0 || isLoggedIn)">
            <div class="d-flex align-items-center justify-content-between mb-2">
                <h5 class="mb-0">Playlists</h5>
                <button class="btn btn-sm btn-outline-primary" @click="createPlaylist">
                    <font-awesome-icon :icon='["fas", "plus"]' />
                    New Playlist
                </button>
            </div>
            <div class="playlist-cards d-flex flex-wrap gap-2">
                <div v-for="pl in playlists" :key="pl.id" class="playlist-card p-2 rounded d-flex align-items-center gap-2">
                    <router-link :to="`/playlist/${pl.id}`" class="flex-grow-1">
                        <strong>{{ pl.name }}</strong>
                        <small class="text-muted ms-1">({{ pl.tabIds.length }})</small>
                    </router-link>
                    <button class="btn btn-sm btn-outline-danger" @click.prevent="deletePlaylist(pl.id, pl.name)">
                        <font-awesome-icon :icon='["fas", "xmark"]' />
                    </button>
                </div>
            </div>
            <div v-if="playlists.length === 0" class="text-muted">No playlists yet</div>
        </div>

        <!-- Favorites Section -->
        <div class="favorites-section" v-if="ready && favoritedTabs.length > 0">
            <TabItem
                v-for="tab in favoritedTabs"
                :key="`fav-${tab.id}`"
                :tab="tab"
                :show-artist="true"
                @delete="deleteTab"
                @favToggled="handleFavToggled"
            />
        </div>

        <div class="search-section mb-3 mt-4 pe-3 ps-3" v-if="ready">
            <div class="input-group">
                <span class="input-group-text">
                    <font-awesome-icon icon="magnifying-glass" />
                </span>

                <input
                    type="text"
                    class="form-control search-input"
                    v-model="searchQuery"
                    placeholder="Search by title or artist..."
                    ref="searchInput"
                    aria-label="Search tabs"
                />

                <button
                    class="input-group-text bg-transparent border-0 cursor-pointer"
                    type="button"
                    @click='searchQuery = ""'
                    v-if="searchQuery"
                    aria-label="Clear search"
                >
                    ✕
                </button>
            </div>

            <div class="d-flex align-items-center gap-2 mt-2">
                <select class="form-select form-select-sm" style="max-width: 180px" v-model="setting.tabSortBy">
                    <option value="dateNewest">Newest First</option>
                    <option value="dateOldest">Oldest First</option>
                    <option value="title">Title (A-Z)</option>
                    <option value="artist">Artist (A-Z)</option>
                </select>

                <button class="btn btn-sm" :class='selectMode ? "btn-primary" : "btn-outline-secondary"' @click="toggleSelectMode">
                    <font-awesome-icon :icon='["fas", "check-double"]' />
                    Select
                </button>
            </div>
        </div>

        <!-- Tag filter bar -->
        <div class="tag-filter-bar ms-3 me-3 mb-3" v-if="ready && allTags.length > 0">
            <span
                v-for="tag in allTags"
                :key="tag"
                class="badge me-1 tag-chip"
                :class='selectedTagFilter === tag ? "bg-primary" : "bg-secondary"'
                @click="filterByTag(tag)"
                role="button"
            >{{ tag }}</span>
        </div>

        <!-- Bulk action bar -->
        <div class="bulk-actions ms-3 me-3 mb-3 d-flex align-items-center gap-2" v-if="selectMode">
            <button class="btn btn-sm btn-outline-secondary" @click="selectAll">Select All</button>
            <button class="btn btn-sm btn-outline-secondary" @click="deselectAll">Deselect All</button>
            <button class="btn btn-sm btn-outline-primary" @click="bulkAddToPlaylist" :disabled="selectedTabIds.length === 0">
                Add to Playlist
            </button>
            <button class="btn btn-sm btn-danger" @click="bulkDelete" :disabled="selectedTabIds.length === 0">
                Delete Selected ({{ selectedTabIds.length }})
            </button>
        </div>

        <div class="mb-4 ms-3" v-if="ready">
            Total Tabs: {{ filteredTabList.length }}
            <span v-if="searchQuery || selectedTagFilter" class="text-muted">
                (of {{ tabList.length }})
            </span>
        </div>

        <template v-if="this.setting.groupByArtist && groupedTabs">
            <div v-for="group in groupedTabs" :key="group.displayName" class="mb-4 ms-3">
                <h4>{{ group.displayName }}</h4>

                <TabItem
                    v-for="tab in group.tabs"
                    :key="tab.id"
                    :tab="tab"
                    :show-artist="false"
                    :selectable="selectMode"
                    :selected="selectedTabIds.includes(tab.id)"
                    @delete="deleteTab"
                    @favToggled="handleFavToggled"
                    @toggle-selected="toggleTabSelection(tab.id)"
                />
            </div>
        </template>

        <template v-else>
            <TabItem
                v-for="tab in filteredTabList"
                :key="tab.id"
                :tab="tab"
                :show-artist="true"
                :selectable="selectMode"
                :selected="selectedTabIds.includes(tab.id)"
                @delete="deleteTab"
                @favToggled="handleFavToggled"
                @toggle-selected="toggleTabSelection(tab.id)"
            />
        </template>

        <div
            v-if="ready && filteredTabList.length === 0 && searchQuery"
            class="empty-state text-center py-5 mb-4 fs-5"
        >
            <p class="text-muted">No tabs found for "{{ searchQuery }}"</p>

            <button class="btn btn-sm btn-outline-secondary" @click='searchQuery = ""'>
                Clear search
            </button>
        </div>
    </div>
</template>

<style scoped lang="scss">
@import "../styles/vars.scss";

.artist-group {
    h3 {
        margin-bottom: 8px;
        margin-top: 20px;
    }
}

h4 {
    color: $color2-dark;
}

.playlist-card {
    background-color: #2a2e33;
    border: 1px solid #444;
    min-width: 150px;

    a {
        text-decoration: none;
    }
}

.tag-chip {
    cursor: pointer;
    font-size: 13px;
    padding: 5px 10px;
    user-select: none;
    transition: background-color 0.2s;
}
</style>

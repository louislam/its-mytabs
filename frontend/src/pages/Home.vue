<script>
import { defineComponent } from "vue";
import { notify } from "@kyvg/vue3-notification";
import { baseURL, getSetting } from "../app.js";
import { isLoggedIn } from "../auth-client.js";
import TabItem from "../components/TabItem.vue";
import { LibraryBrowseSchema } from "../zod.ts";

export default defineComponent({
    components: {
        TabItem,
    },

    data() {
        return {
            tabList: [],
            ready: false,
            isLoggedIn: false,
            searchQuery: "",
            setting: {},
            library: null,
            expandedAlbums: {},
            expandedSongs: {},
            searchRefreshTimer: null,
            libraryRequestId: 0,
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
            await this.refreshLibrary();
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
        filteredTabList() {
            return this.tabList;
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

        filteredLibrary() {
            return this.library;
        },

        useLibraryGrouping() {
            return this.setting.groupByArtist && this.filteredLibrary && this.filteredLibrary.artists.length > 0;
        },
    },

    watch: {
        searchQuery() {
            if (!this.ready) {
                return;
            }
            if (this.searchRefreshTimer) {
                window.clearTimeout(this.searchRefreshTimer);
            }
            this.searchRefreshTimer = window.setTimeout(() => {
                this.refreshLibrary().catch((error) => {
                    notify({
                        text: error.message,
                        type: "error",
                    });
                });
            }, 250);
        },
    },

    beforeUnmount() {
        if (this.searchRefreshTimer) {
            window.clearTimeout(this.searchRefreshTimer);
        }
    },

    methods: {
        handleFavToggled() {
            // Force re-render by creating a new array reference
            this.tabList = [...this.tabList];
        },

        isSongExpanded(song) {
            return !!this.expandedSongs[song.id];
        },

        isAlbumExpanded(album) {
            return this.expandedAlbums[album.id] !== false;
        },

        toggleAlbum(album) {
            this.expandedAlbums = {
                ...this.expandedAlbums,
                [album.id]: !this.isAlbumExpanded(album),
            };
        },

        toggleSong(song) {
            this.expandedSongs = {
                ...this.expandedSongs,
                [song.id]: !this.expandedSongs[song.id],
            };
        },

        primaryVersion(song) {
            return song.preferredVersion || song.versions[0];
        },

        versionTitle(version) {
            return version.versionLabel || `Version ${version.version}`;
        },

        versionMeta(version) {
            const parts = [];
            if (version.ext) {
                parts.push(version.ext.toUpperCase());
            }
            if (version.public) {
                parts.push("Public");
            }
            if (version.hasAudio) {
                parts.push("Audio");
            }
            if (version.hasYoutube) {
                parts.push("YouTube");
            }
            return parts.join(" / ");
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
                    await this.refreshLibrary();

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

        async refreshLibrary() {
            const params = new URLSearchParams({
                mode: "album",
                limit: "1000",
            });
            if (this.searchQuery.trim()) {
                params.set("search", this.searchQuery.trim());
            }
            const requestId = ++this.libraryRequestId;
            const libraryRes = await fetch(baseURL + `/api/library?${params.toString()}`, { credentials: "include" });
            const libraryData = await libraryRes.json();
            if (requestId !== this.libraryRequestId) {
                return;
            }
            this.library = LibraryBrowseSchema.parse(libraryData.library);
            this.tabList = this.flattenLibraryTabs(this.library);
        },

        flattenLibraryTabs(library) {
            const tabs = [];
            const addSongVersions = (song) => {
                for (const version of song.versions) {
                    tabs.push({
                        id: version.id,
                        title: version.title,
                        artist: version.artist,
                        filename: version.filename,
                        originalFilename: version.originalFilename,
                        createdAt: version.createdAt,
                        public: version.public,
                        fav: version.fav,
                    });
                }
            };

            for (const artist of library.artists) {
                for (const album of artist.albums) {
                    album.songs.forEach(addSongVersions);
                }
                artist.songs.forEach(addSongVersions);
            }
            return tabs;
        },
    },
});
</script>

<template>
    <div class="container my-container">
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
        </div>

        <div class="mb-4 ms-3" v-if="ready">
            <template v-if="useLibraryGrouping">
                Total Songs: {{ filteredLibrary.songCount }} / Versions: {{ filteredLibrary.versionCount }}
            </template>
            <template v-else>
                Total Tabs: {{ filteredTabList.length }}
                <span v-if="searchQuery" class="text-muted">
                    (of {{ tabList.length }})
                </span>
            </template>
        </div>

        <template v-if="useLibraryGrouping">
            <div v-for="artist in filteredLibrary.artists" :key="artist.id" class="library-artist mb-4 ms-3 me-3">
                <h4>{{ artist.name }}</h4>

                <div v-for="album in artist.albums" :key="album.id" class="library-album mb-3">
                    <h4 class="album-title">
                        <button class="album-title-button" type="button" @click="toggleAlbum(album)" :aria-expanded="isAlbumExpanded(album)">
                            <font-awesome-icon :icon='isAlbumExpanded(album) ? "chevron-down" : "chevron-right"' />
                            <span>{{ album.title }}</span>
                        </button>
                    </h4>

                    <div v-for="song in album.songs" v-show="isAlbumExpanded(album)" :key="song.id" class="library-song">
                        <div class="song-row" :class="{ 'song-row-single': song.versionCount <= 1 }">
                            <button v-if="song.versionCount > 1" class="expand-btn" type="button" @click="toggleSong(song)" :aria-label="isSongExpanded(song) ? 'Collapse versions' : 'Expand versions'">
                                <font-awesome-icon :icon='isSongExpanded(song) ? "chevron-down" : "chevron-right"' />
                            </button>

                            <router-link class="song-main" :to="`/tab/${primaryVersion(song).id}`">
                                <span class="song-title">{{ song.title }}</span>
                                <span v-if="song.versionCount > 1" class="song-meta">{{ song.versionCount }} versions</span>
                            </router-link>
                        </div>

                        <div class="version-list" v-if="song.versionCount > 1 && isSongExpanded(song)">
                            <router-link v-for="version in song.versions" :key="version.id" class="version-row" :to="`/tab/${version.id}`">
                                <span class="version-name">
                                    {{ versionTitle(version) }}
                                    <font-awesome-icon v-if="version.preferred" icon="check" class="preferred-icon" />
                                    <font-awesome-icon v-if="version.fav" icon="star" class="fav-icon" />
                                </span>
                                <span class="version-meta">{{ versionMeta(version) }}</span>
                            </router-link>
                        </div>
                    </div>
                </div>

                <div v-for="song in artist.songs" :key="song.id" class="library-song">
                    <div class="song-row" :class="{ 'song-row-single': song.versionCount <= 1 }">
                        <button v-if="song.versionCount > 1" class="expand-btn" type="button" @click="toggleSong(song)" :aria-label="isSongExpanded(song) ? 'Collapse versions' : 'Expand versions'">
                            <font-awesome-icon :icon='isSongExpanded(song) ? "chevron-down" : "chevron-right"' />
                        </button>

                        <router-link class="song-main" :to="`/tab/${primaryVersion(song).id}`">
                            <span class="song-title">{{ song.title }}</span>
                            <span v-if="song.versionCount > 1" class="song-meta">{{ song.versionCount }} versions</span>
                        </router-link>
                    </div>

                    <div class="version-list" v-if="song.versionCount > 1 && isSongExpanded(song)">
                        <router-link v-for="version in song.versions" :key="version.id" class="version-row" :to="`/tab/${version.id}`">
                            <span class="version-name">
                                {{ versionTitle(version) }}
                                <font-awesome-icon v-if="version.preferred" icon="check" class="preferred-icon" />
                                <font-awesome-icon v-if="version.fav" icon="star" class="fav-icon" />
                            </span>
                            <span class="version-meta">{{ versionMeta(version) }}</span>
                        </router-link>
                    </div>
                </div>
            </div>
        </template>

        <template v-else-if="this.setting.groupByArtist && groupedTabs">
            <div v-for="group in groupedTabs" :key="group.displayName" class="mb-4 ms-3">
                <h4>{{ group.displayName }}</h4>

                <TabItem
                    v-for="tab in group.tabs"
                    :key="tab.id"
                    :tab="tab"
                    :show-artist="false"
                    @delete="deleteTab"
                    @favToggled="handleFavToggled"
                />
            </div>
        </template>

        <template v-else>
            <TabItem
                v-for="tab in filteredTabList"
                :key="tab.id"
                :tab="tab"
                :show-artist="true"
                @delete="deleteTab"
                @favToggled="handleFavToggled"
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

.library-album {
    padding-left: 10px;
}

.album-title {
    color: $color2-dark;
    font-weight: 600;
    margin: 10px 0;
}

.album-title-button {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    border: 0;
    padding: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
}

.library-song {
    border-radius: 6px;

    &:hover {
        background-color: rgba(0, 0, 0, 0.04);
    }
}

.song-row,
.version-row {
    display: flex;
    align-items: center;
    gap: 10px;
}

.song-row {
    min-height: 44px;
}

.song-row-single {
    padding-left: 42px;
}

.expand-btn {
    width: 32px;
    height: 32px;
    border: 0;
    background: transparent;
    color: $color2-dark;
}

.song-main,
.version-row {
    flex: 1;
    min-width: 0;
    text-decoration: none;
}

.song-main {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding-right: 12px;
}

.song-title,
.version-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.song-title {
    font-size: 18px;
}

.song-meta,
.version-meta {
    color: $color2-dark;
    font-size: 13px;
    white-space: nowrap;
}

.version-list {
    margin-left: 42px;
    padding: 0 12px 8px 0;
}

.version-row {
    justify-content: space-between;
    min-height: 32px;
    padding: 4px 0;
    color: inherit;
}

.preferred-icon {
    color: #198754;
    margin-left: 6px;
}

.fav-icon {
    color: #ffa500;
    margin-left: 6px;
}
</style>

<script>
import { defineComponent } from "vue";
import { notify } from "@kyvg/vue3-notification";
import { baseURL } from "../app.js";
import { isLoggedIn } from "../auth-client.js";

export default defineComponent({
    data() {
        return {
            tabList: [],
            ready: false,
            isLoggedIn: false,
<<<<<<< HEAD
            searchQuery: "",
=======
            groupByArtist: false,
>>>>>>> 0d78a36 (feat : add checkbox to group by artist)
        };
    },

    async mounted() {
        this.isLoggedIn = await isLoggedIn();

        if (!this.isLoggedIn) {
            this.$router.push("/login");
            return;
        }

        try {
            const res = await fetch(baseURL + "/api/tabs", { credentials: "include" });
            const data = await res.json();
            this.tabList = data.tabs;
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
<<<<<<< HEAD
    computed: {
        filteredTabList() {
            if (!this.searchQuery.trim()) {
                return this.tabList;
            }

            const query = this.searchQuery.trim().toLowerCase();

            return this.tabList.filter((tab) => {
                const title = (tab.title || "").toLowerCase();
                const artist = (tab.artist || "").toLowerCase();
                return title.includes(query) || artist.includes(query);
            });
        },
    },
=======

    computed: {
        sortedTabs() {
            return [...this.tabList].sort((a, b) => {
                const artistA = a.artist.toLowerCase();
                const artistB = b.artist.toLowerCase();

                if (artistA < artistB) return -1;
                if (artistA > artistB) return 1;

                return a.title.localeCompare(b.title);
            });
        },

        tabsByArtist() {
            const groups = {};

            for (const tab of this.sortedTabs) {
                const key = tab.artist.trim().toLowerCase();

                if (!groups[key]) {
                    groups[key] = {
                        displayName: tab.artist,
                        tabs: [],
                    };
                }

                groups[key].tabs.push(tab);
            }

            return Object.fromEntries(
                Object.entries(groups).sort((a, b) =>
                    a[0].localeCompare(b[0])
                )
            );
        },

        displayedTabs() {
            return this.groupByArtist ? this.tabsByArtist : this.sortedTabs;
        },
    },

>>>>>>> 0d78a36 (feat : add checkbox to group by artist)
    methods: {
        async deleteTab(id, title, artist) {
            if (!confirm(`Are you sure you want to delete ${artist} - ${title}?`)) {
                return;
            }
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
<<<<<<< HEAD
        <div class="search-section mb-4 mt-5" v-if="ready">
            <div class="input-group">
                <span class="input-group-text">
                    <font-awesome-icon icon="magnifying-glass" />
                </span>
                <input
                    type="text"
                    class="form-control search-input"
                    v-model="searchQuery"
                    placeholder="Search by title or artist..."
                    aria-label="Search tabs"
                    ref="searchInput"
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
            Total Tabs: {{ filteredTabList.length }}
            <span v-if="searchQuery" class="text-muted">
                (of {{ tabList.length }})
            </span>
        </div>

        <div v-for="tab in filteredTabList" :key="tab.id" class="tab-item p-3 rounded">
            <router-link class="info" :to="`/tab/${tab.id}`">
                <div class="title">{{ tab.title }}</div>
                <div class="artist">{{ tab.artist }}</div>
            </router-link>
=======
        <div class="mb-4 mt-5 ms-3" v-if="ready">
            Total Tabs: {{ tabList.length }}

            <div class="form-check mt-2">
                <input type="checkbox" class="form-check-input" id="groupByArtist" v-model="groupByArtist" />
                <label class="form-check-label" for="groupByArtist">Group by artist    </label>
            </div>
        </div>

        <div v-if="groupByArtist && ready">
            <div
                v-for="(group, key) in displayedTabs"
                :key="key"
                class="artist-group mb-4"
            >
                <h4 class="ms-2">{{ group.displayName }}</h4>
>>>>>>> 0d78a36 (feat : add checkbox to group by artist)

                <div
                    v-for="tab in group.tabs"
                    :key="tab.id"
                    class="tab-item p-3 rounded"
                >
                    <router-link class="info" :to="`/tab/${tab.id}`">
                        <div class="title">{{ tab.title }}</div>
                    </router-link>

                    <button
                        class="btn btn-secondary me-2"
                        @click="$router.push(`/tab/${tab.id}/edit/info`)"
                    >
                        Edit
                    </button>
                    <button
                        class="btn btn-danger"
                        @click="deleteTab(tab.id, tab.title, tab.artist)"
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>

        <div v-else-if="ready">
            <div
                v-for="tab in displayedTabs"
                :key="tab.id"
                class="tab-item p-3 rounded"
            >
                <router-link class="info" :to="`/tab/${tab.id}`">
                    <div class="title">{{ tab.title }}</div>
                    <div class="artist">{{ tab.artist }}</div>
                </router-link>

                <button
                    class="btn btn-secondary me-2"
                    @click="$router.push(`/tab/${tab.id}/edit/info`)"
                >
                    Edit
                </button>
                <button
                    class="btn btn-danger"
                    @click="deleteTab(tab.id, tab.title, tab.artist)"
                >
                    Delete
                </button>
            </div>
        </div>

        <div v-if="ready && filteredTabList.length === 0 && searchQuery" class="empty-state text-center py-5 mb-4 fs-5">
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

.tab-item {
    display: flex;
    transition: background-color 0.1s;

    &:hover {
        background-color: rgba(0, 0, 0, 0.05);
    }

    .info {
        flex-grow: 1;

        .title {
            font-size: 20px;
        }

        .artist {
            color: $color2-dark;
        }
    }

    button {
        align-self: center;
    }
}
</style>

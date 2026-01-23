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
            ready: false,
            isLoggedIn: false,
            searchQuery: "",
            setting: {},
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

    computed: {
        filteredTabList() {
            if (!this.searchQuery.trim()) return this.tabList;

            const query = this.searchQuery.trim().toLowerCase();

            return this.tabList.filter((tab) => {
                const title = (tab.title || "").toLowerCase();
                const artist = (tab.artist || "").toLowerCase();
                return title.includes(query) || artist.includes(query);
            });
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
            Total Tabs: {{ filteredTabList.length }}
            <span v-if="searchQuery" class="text-muted">
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
</style>

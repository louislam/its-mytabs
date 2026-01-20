<script>
import { defineComponent } from "vue";
import { notify } from "@kyvg/vue3-notification";
import { baseURL } from "../app.js";

export default defineComponent({
    props: {
        tab: {
            type: Object,
            required: true,
        },
        showArtist: {
            type: Boolean,
            default: true,
        },
    },

    emits: ["delete", "favToggled"],

    methods: {
        handleEdit() {
            this.$router.push(`/tab/${this.tab.id}/edit/info`);
        },

        handleDelete() {
            this.$emit("delete", this.tab.id, this.tab.title, this.tab.artist);
        },

        async toggleFav() {
            const newFavStatus = !this.tab.fav;

            try {
                const res = await fetch(baseURL + `/api/tab/${this.tab.id}/fav`, {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        fav: newFavStatus,
                    }),
                });

                if (res.status === 200) {
                    this.tab.fav = newFavStatus;
                    this.$emit("favToggled");
                } else {
                    const data = await res.json();
                    throw new Error(data.message || "Failed to update favorite status");
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
    <div class="tab-item p-3 rounded">
        <button
            class="fav-btn"
            @click="toggleFav"
            :class='{ "fav-active": tab.fav }'
            :aria-label='tab.fav ? "Remove from favorites" : "Add to favorites"'
        >
            <font-awesome-icon
                :icon='tab.fav ? "star" : ["far", "star"]'
            />
        </button>

        <router-link class="info" :to="`/tab/${tab.id}`">
            <div class="title">{{ tab.title }}</div>
            <div class="artist" v-if="showArtist">{{ tab.artist }}</div>
        </router-link>

        <button class="btn btn-secondary me-2" @click="handleEdit">
            Edit
        </button>

        <button class="btn btn-danger" @click="handleDelete">
            Delete
        </button>
    </div>
</template>

<style scoped lang="scss">
@import "../styles/vars.scss";

.tab-item {
    display: flex;
    transition: background-color 0.1s;

    &:hover {
        background-color: rgba(0, 0, 0, 0.05);
    }

    .fav-btn {
        background: none;
        border: none;
        font-size: 20px;
        color: #9e9e9e;
        cursor: pointer;
        padding: 0;
        margin-right: 12px;
        align-self: center;
        transition: color 0.2s;

        &:hover {
            color: #ffa500;
        }

        &.fav-active {
            color: #ffa500;
        }
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

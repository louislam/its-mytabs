<script>
import { defineComponent } from "vue";

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

    emits: ["delete"],

    methods: {
        handleEdit() {
            this.$router.push(`/tab/${this.tab.id}/edit/info`);
        },

        handleDelete() {
            this.$emit("delete", this.tab.id, this.tab.title, this.tab.artist);
        },
    },
});
</script>

<template>
    <div class="tab-item p-3 rounded">
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

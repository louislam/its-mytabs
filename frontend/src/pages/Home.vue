<script>
import { defineComponent } from "vue";
import {notify} from "@kyvg/vue3-notification";
import {baseURL} from "../app.js";

export default defineComponent({
    data() {
        return {
            tabList: [],
        }
    },
    async mounted() {
        try {
            const res = await fetch(baseURL + "/api/tabs", { credentials: 'include' });
            const data = await res.json();
            this.tabList = data.tabs;
        } catch (error) {
            notify({
                text: error.message,
                type: "error",
            });
        }
  
    },
    methods: {
        async deleteTab(id, title, artist) {
            if (!confirm(`Are you sure you want to delete ${artist} - ${title}?`)) {
                return;
            }
            try {
                const res = await fetch(baseURL + `/api/tab/${id}`, {
                    method: "DELETE",
                    credentials: 'include'
                });
                if (res.status === 200) {
                    this.tabList = this.tabList.filter(tab => tab.id !== id);
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
        }
    }
});
</script>

<template>
    <div class="container my-container">
        <div class="mb-4 mt-5 ms-4">
            Total Tabs: {{ tabList.length }}
        </div>

        <div v-for="tab in tabList" :key="tab.id"  class="tab-item p-4">
            <router-link class="info" :to="`/tab/${tab.id}`">
                <div class="title">{{ tab.title }}</div>
                <div class="artist">{{ tab.artist }}</div>
            </router-link>

            <button class="btn btn-danger" @click="deleteTab(tab.id, tab.title, tab.artist)">Delete</button>

        </div>
        </div>
</template>

<style scoped lang="scss">
@import "../styles/vars.scss";

.my-container {
    
}

.tab-item {
    display: flex;
    border-radius: 30px;
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
}
</style>

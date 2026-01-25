<script setup lang="ts">
import { useRoute } from "vue-router";
import { Notifications } from "@kyvg/vue3-notification";
import { computed, ref } from "vue";
const route = useRoute();

// @ts-ignore
const version = ref(appVersion);
const hideFooter = computed(() => route.meta?.hideFooter);
</script>

<template>
    <div>
        <!-- Add :key to disable vue router re-use the same component -->
        <router-view :key="route.fullPath" />

        <footer v-if="!hideFooter" class="my-5">
            It's MyTabs
            <span class="version">{{ version }}</span>
        </footer>

        <notifications position="bottom right" />
    </div>
</template>

<style lang="scss" scoped>
@import "../styles/vars.scss";

footer {
    text-align: center;
    font-size: 0.9rem;
    color: $color2-dark;
}
</style>

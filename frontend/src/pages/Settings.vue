<script lang="ts">
import { defineComponent } from "vue";
import { SettingSchema } from "../zod.ts";
import { getSetting } from "../app.js";

export default defineComponent({
    data() {
        return {
            setting: {
                scoreColor: "",
                noteColor: "",
                cursor: "",
                scoreStyle: "",
            },
        };
    },
    mounted() {
        this.setting = getSetting();
    },
    watch: {
        setting: {
            handler(newSetting) {
                const parsedSetting = SettingSchema.parse(newSetting);
                localStorage.setItem("userSetting", JSON.stringify(parsedSetting));
            },
            deep: true,
        },
    },
});
</script>

<template>
    <div class="container my-container">
        <h1 class="mb-5">Settings</h1>

        <!--     scoreStyle: z.enum(["tab", "score-tab", "score"]).default("tab"), -->
        <div class="mb-3">
            <label for="scoreStyle" class="form-label">Style</label>
            <select id="scoreStyle" class="form-select" v-model="setting.scoreStyle">
                <option value="tab">Tab</option>
                <option value="score">Score</option>
                <option value="score-tab">Tab + Score</option>
            </select>
        </div>

        <!-- Score Color Dropdown -->
        <div class="mb-3">
            <label for="scoreColor" class="form-label">Tab/Score Color</label>
            <select id="scoreColor" class="form-select" v-model="setting.scoreColor">
                <option value="light">Light</option>
                <option value="dark">Dark</option>
            </select>
        </div>

        <h2 class="mt-5 mb-4">Assists</h2>

        <!-- Note Color refer to SettingSchema   noteColor: z.enum(["rocksmith", "none"]).default("none"), -->
        <div class="mb-3">
            <label for="noteColor" class="form-label">Note Color</label>
            <select id="noteColor" class="form-select" v-model="setting.noteColor">
                <option value="none">No Color</option>
                <option value="rocksmith">Rocksmith 2014 Color Scheme</option>
            </select>
        </div>

        <!--     cursor: z.enum(["animated", "instant", "bar", "invisible"]).default("animated"),-->
        <div class="mb-3">
            <label for="cursor" class="form-label">Cursor Style</label>
            <select id="cursor" class="form-select" v-model="setting.cursor">
                <option value="invisible">No Cursor</option>
                <option value="animated">Cursor (Smooth)</option>
                <option value="instant">Cursor (Instant)</option>
                <option value="bar">Bar</option>
            </select>
        </div>

        <p class="text-secondary">Tips: If you want to check if the sync points is correct, "Cursor (Instant)" is a good indicator.</p>
    </div>
</template>

<style scoped lang="scss">
</style>

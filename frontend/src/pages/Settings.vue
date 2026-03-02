<script lang="ts">
import { defineComponent } from "vue";
import { SettingSchema } from "../zod.ts";
import { baseURL, checkFetch, generalError, getSetting, successMessage } from "../app.js";
import { ScrollMode } from "@coderline/alphatab";

export default defineComponent({
    computed: {
        ScrollMode() {
            return ScrollMode;
        },
    },
    data() {
        return {
            setting: {
                scoreColor: "",
                noteColor: "",
                cursor: "",
                scoreStyle: "",
                groupByArtist: false,
                showKeySignature: false,
                scrollMode: "",
                scale: 1,
                toolbarAutoHide: false,
            },
            isProcessing: false,
        };
    },
    mounted() {
        this.setting = getSetting();
    },
    methods: {
        /**
         * Load the setting from the server
         */
        async loadFromServer() {
            const ok = window.confirm("This will overwrite your local settings. Are you sure?");
            if (!ok) {
                return;
            }

            try {
                this.isProcessing = true;
                const res = await fetch(baseURL + `/api/settings`, {
                    credentials: "include",
                });
                await checkFetch(res);
                const data = await res.json();
                const serverSetting = data.setting || {};
                const parsed = SettingSchema.parse(serverSetting);
                this.setting = parsed;
                localStorage.setItem("userSetting", JSON.stringify(parsed));
                successMessage("Settings loaded from server");
            } catch (e) {
                generalError(e);
            } finally {
                this.isProcessing = false;
            }
        },

        /**
         * Save the current setting to the server.
         */
        async saveToServer() {
            const ok = window.confirm("This will overwrite the settings stored on the server. Are you sure?");
            if (!ok) {
                return;
            }

            try {
                this.isProcessing = true;
                const parsedSetting = SettingSchema.parse(this.setting);
                const res = await fetch(baseURL + `/api/settings`, {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(parsedSetting),
                });
                await checkFetch(res);
                successMessage("Settings saved to server");
            } catch (e) {
                generalError(e);
            } finally {
                this.isProcessing = false;
            }
        },
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
        <h1 class="mb-3">Settings</h1>

        <h2 class="mt-4 mb-4">Tab Player</h2>

        <!--     scoreStyle: z.enum(["tab", "score-tab", "score"]).default("tab"), -->
        <div class="mb-3">
            <label for="scoreStyle" class="form-label">Style</label>
            <select id="scoreStyle" class="form-select" v-model="setting.scoreStyle">
                <option value="tab">Tab</option>
                <option value="score">Score</option>
                <option value="score-tab">Tab + Score</option>
                <option value="horizontal-tab">Horizontal Tab</option>
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

        <!-- Tab/Score Display Scale -->
        <div class="mb-3">
            <label for="scale" class="form-label">Tab/Score Display Scale</label>
            <select id="scale" class="form-select" v-model.number="setting.scale">
                <option :value="0.8">80%</option>
                <option :value="1">100%</option>
                <option :value="1.1">110%</option>
                <option :value="1.2">120%</option>
                <option :value="1.3">130%</option>
                <option :value="1.4">140%</option>
                <option :value="1.5">150%</option>
                <option :value="2">200%</option>
                <option :value="3">300%</option>
            </select>
        </div>

        <!-- Scroll Mode -->
        <div class="mb-3">
            <label for="scrollMode" class="form-label">
                Scroll
                <span v-if='setting.scoreStyle === "horizontal-tab"'> (Force Smooth Scroll for Horizontal Tab)</span>
            </label>
            <select id="scrollMode" class="form-select" v-model="setting.scrollMode" :disabled='setting.scoreStyle === "horizontal-tab"'>
                <option :value="ScrollMode.Continuous">Scroll</option>
                <option :value="ScrollMode.Off">Off</option>
                <option :value="ScrollMode.Smooth">Smooth Scroll</option>
            </select>
        </div>

        <!-- Show Key Signature -->
        <div class="mb-3">
            <label for="showKeySignature" class="form-label">Show Key Signature</label>
            <select id="showKeySignature" class="form-select" v-model="setting.showKeySignature">
                <option :value="true">Yes</option>
                <option :value="false">No</option>
            </select>
        </div>

        <!-- Toolbar Auto-hide -->
        <div class="mb-3">
            <label for="toolbarAutoHide" class="form-label">Auto-hide bottom toolbar</label>
            <select id="toolbarAutoHide" class="form-select" v-model="setting.toolbarAutoHide">
                <option :value="false">No</option>
                <option :value="true">Yes</option>
            </select>
        </div>

        <h2 class="mt-5 mb-4">Assists</h2>

        <!-- Note Color refer to SettingSchema   noteColor: z.enum(["rocksmith", "none"]).default("none"), -->
        <div class="mb-3">
            <label for="noteColor" class="form-label">Note Color</label>
            <select id="noteColor" class="form-select" v-model="setting.noteColor">
                <option value="none">No Color</option>
                <option value="rocksmith">Rocksmith 2014 Color Scheme</option>
                <option value="louis-bass-v">Louis' 5-string Bass Color Scheme</option>
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

        <h2 class="mt-5 mb-4">Tab List</h2>

        <!-- Group by artist -->
        <div class="mb-3">
            <label for="groupByArtist" class="form-label">Group tabs by Artist</label>
            <select id="groupByArtist" class="form-select" v-model="setting.groupByArtist">
                <option :value="false">No</option>
                <option :value="true">Yes</option>
            </select>
        </div>

        <h2 class="mt-5 mb-4">Others</h2>

        <div class="mb-3">
            <label class="form-label">Load/Save Settings to Server</label>

            <div class="d-flex gap-2">
                <button class="btn btn-secondary" :disabled="isProcessing" @click.prevent="loadFromServer">Load</button>
                <button class="btn btn-secondary" :disabled="isProcessing" @click.prevent="saveToServer">Save</button>
            </div>
        </div>
    </div>
</template>

<style scoped lang="scss">
</style>

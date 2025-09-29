<script>
import { defineComponent } from "vue";
import { baseURL, checkFetch, convertAlphaTexSyncPoint, generalError } from "../app.js";
import { notify } from "@kyvg/vue3-notification";
import Vue3Dropzone from "@jaxtheprime/vue3-dropzone";
import { supportedAudioFormatCommaString, supportedFormatCommaString } from "../../../backend/common.js";
import SyncOptions from "../components/SyncOptions.vue";

const alphaTab = await import("@coderline/alphatab");

export default defineComponent({
    components: { SyncOptions, Vue3Dropzone },
    data() {
        return {
            tabID: -1,
            tab: {},
            page: "",
            youtubeURL: "",
            youtubeList: [],
            audioList: [],
            // isLocalIP: false,
            supportedFormatCommaString,
            supportedAudioFormatCommaString,
            filePath: "",
            tabFiles: [],
            audioFiles: [],
        };
    },
    async mounted() {
        this.tabID = this.$route.params.id;
        this.page = this.$route.path.split("/").pop();

        try {
            await this.load();
        } catch (e) {
            generalError(e);
        }

        //this.isLocalIP = !!isPrivateIP(window.location.hostname);
    },
    methods: {
        async load() {
            const res = await fetch(baseURL + `/api/tab/${this.tabID}`, {
                credentials: "include",
            });
            await checkFetch(res);
            const data = await res.json();
            this.tab = data.tab;
            this.youtubeList = data.youtubeList;
            this.audioList = data.audioList;
            this.filePath = data.filePath;
        },

        async submitInfo() {
            try {
                const tabID = this.$route.params.id;
                const res = await fetch(baseURL + `/api/tab/${tabID}`, {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        title: this.tab.title,
                        artist: this.tab.artist,
                        public: this.tab.public,
                    }),
                });

                await checkFetch(res);

                notify({
                    text: "Tab info updated successfully",
                    type: "success",
                });
            } catch (e) {
                generalError(e);
            }
        },
        async addYoutube() {
            try {
                // Validate URL
                const url = this.youtubeURL;

                const obj = new URL(url);

                if (obj.hostname !== "www.youtube.com" && obj.hostname !== "music.youtube.com") {
                    throw new Error("Invalid YouTube URL");
                }

                // Get ?v
                const videoID = obj.searchParams.get("v");
                if (!videoID) {
                    throw new Error("Invalid YouTube URL, no ?v= params?");
                }

                // Send to api (/tab/:id/youtube)
                const tabID = this.tab.id;

                const res = await fetch(baseURL + `/api/tab/${tabID}/youtube`, {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        videoID,
                    }),
                });

                await checkFetch(res);
                this.youtubeURL = "";

                await this.load();
            } catch (e) {
                generalError(e);
            }
        },
        
        async saveYoutube(video) {
            let res;
            try {
                const tabID = this.tab.id;
                res = await fetch(baseURL + `/api/tab/${tabID}/youtube/${video.videoID}`, {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        syncMethod: video.syncMethod,
                        simpleSync: video.simpleSync,
                        advancedSync: video.advancedSync,
                    }),
                });

                await checkFetch(res);

                notify({
                    text: "YouTube video updated successfully",
                    type: "success",
                });
            } catch (e) {
                generalError(e);
            }
        },
        
        async removeYoutube(video) {
            try {
                if (!confirm("Are you sure you want to remove this YouTube video?")) {
                    return;
                }

                const tabID = this.tab.id;

                const res = await fetch(baseURL + `/api/tab/${tabID}/youtube/${video.videoID}`, {
                    method: "DELETE",
                    credentials: "include",
                });

                await checkFetch(res);

                notify({
                    text: "YouTube video removed successfully",
                    type: "success",
                });

                await this.load();
            } catch (e) {
                generalError(e);
            }
        },

        async uploadTab() {
            try {
                if (this.tabFiles.length === 0) {
                    throw new Error("Please select a file to upload");
                }

                const file = this.tabFiles[0].file;

                // Try to parse the file with AlphaTab to ensure it's valid
                const data = await file.arrayBuffer();

                const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(
                    new Uint8Array(data),
                    new alphaTab.Settings(),
                );

                const formData = new FormData();
                formData.append("file", file);

                const response = await fetch(baseURL + `/api/tab/${this.tabID}/replace`, {
                    method: "POST",
                    credentials: "include",
                    body: formData,
                });

                await checkFetch(response);
                notify({
                    text: "Tab file uploaded and replaced successfully",
                    type: "success",
                });
                this.$router.push(`/tab/${this.tabID}`);
            } catch (error) {
                notify({
                    text: error.message,
                    type: "error",
                });
            }
        },

        async uploadAudio() {
            try {
                if (this.audioFiles.length === 0) {
                    throw new Error("Please select a file to upload");
                }

                const file = this.audioFiles[0].file;
                const formData = new FormData();
                formData.append("file", file);

                const response = await fetch(baseURL + `/api/tab/${this.tabID}/audio`, {
                    method: "POST",
                    credentials: "include",
                    body: formData,
                });

                await checkFetch(response);
                notify({
                    text: "Upload audio successfully",
                    type: "success",
                });
                await this.load();
            } catch (error) {
                notify({
                    text: error.message,
                    type: "error",
                });
            }
        },

        async saveAudio(audio) {
            let res;
            try {
                const tabID = this.tab.id;
                const encoded = encodeURIComponent(audio.filename);
                res = await fetch(baseURL + `/api/tab/${tabID}/audio/${encoded}`, {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        syncMethod: audio.syncMethod,
                        simpleSync: audio.simpleSync,
                        advancedSync: audio.advancedSync,
                    }),
                });

                await checkFetch(res);

                notify({
                    text: "Updated successfully",
                    type: "success",
                });
            } catch (e) {
                generalError(e);
            }
        },

        async removeAudio(audio) {
            try {
                if (!confirm("Are you sure you want to remove this audio file?")) {
                    return;
                }

                const tabID = this.tab.id;
                const encoded = encodeURIComponent(audio.filename);
                
                const res = await fetch(baseURL + `/api/tab/${tabID}/audio/${encoded}`, {
                    method: "DELETE",
                    credentials: "include",
                });

                await checkFetch(res);

                notify({
                    text: "The audio file has been removed successfully",
                    type: "success",
                });

                await this.load();
            } catch (e) {
                generalError(e);
            }
        },

        dropzoneError(err) {
            console.log(err);
            let error = err.type;
            notify({
                text: error,
                type: "error",
            });
        },

        getAudioURL(tabID, filename) {
            return baseURL + `/api/tab/${tabID}/audio/${encodeURIComponent(filename)}`;
        },
    },
});
</script>

<template>
    <div class="my-container container">
        <div class="mt-4 mb-4">
            <router-link :to="`/tab/${tab.id}`" class="btn btn-primary">
                Back to Tab</router-link>

            <div class="mt-3">
                Editing: {{ tab.artist }} - {{ tab.title }}
            </div>
        </div>

        <div class="menu">
            <div class="btn-group" role="group">
                <router-link :to="`/tab/${tab.id}/edit/info`" class="btn btn-secondary">Info</router-link>
                <router-link :to="`/tab/${tab.id}/edit/audio`" class="btn btn-secondary">Youtube & Audio files</router-link>
                <router-link :to="`/tab/${tab.id}/edit/tab-file`" class="btn btn-secondary">Tab file</router-link>
            </div>
        </div>

        <!-- Info Page -->
        <div v-if='this.page === "info"'>
            <h2 class="mt-4 mb-4">Info</h2>
            <form>
                <!-- Tab Name -->
                <div class="mb-3">
                    <label for="tabName" class="form-label">Name</label>
                    <input type="text" class="form-control" id="tabName" v-model="tab.title">
                </div>

                <!-- Artist -->
                <div class="mb-3">
                    <label for="tabArtist" class="form-label">Artist</label>
                    <input type="text" class="form-control" id="tabArtist" v-model="tab.artist">
                </div>

                <!-- Public (Dropdown) -->
                <div class="mb-3">
                    <label for="tabPublic" class="form-label">Share to public</label>
                    <select class="form-control" id="tabPublic" v-model="tab.public">
                        <option :value="false">Private</option>
                        <option :value="true">Public</option>
                    </select>
                </div>

                <!-- Save -->
                <button type="submit" class="btn btn-primary me-2" @click.prevent="submitInfo()">Save</button>
            </form>
        </div>

        <!-- Audio Page -->
        <div v-else-if='this.page === "audio"'>

            <h3 class="mt-4 mb-2">Youtube</h3>
            
            <!-- Show alert if using a local ip -->
            <div class="alert alert-info mt-3" role="alert">
                Tip: Youtube videos may not work on a private ip (such as 127.0.0.1). Please use <strong>localhost</strong> or other hostname.
            </div>

            <div class="mb-3">
                <label for="basic-url" class="form-label">Youtube URL</label>
                <div class="input-group">
                    <input type="text" class="form-control" id="basic-url" placeholder="" v-model="youtubeURL">
                    <button class="btn btn-primary" type="button" @click.prevent="addYoutube()">Add</button>
                </div>
            </div>

            <div class="mb-4">

                <!-- Youtube Item -->
                <div v-for="video in youtubeList" :key="video.id" class="mb-3 pb-5 youtube-item">
                    <iframe
                        width="355"
                        height="200"
                        :src="`https://www.youtube.com/embed/${video.videoID}`"
                        title="YouTube video player"
                        frameborder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowfullscreen
                    ></iframe>

                    <div class="info">
                        <div class="mb-3">
                            <strong>Video ID:</strong> <a :href="`https://www.youtube.com/watch?v=${video.videoID}`" target="_blank">{{ video.videoID }}</a>
                        </div>

                        <SyncOptions
                            :syncMethod="video.syncMethod"
                            :simpleSync="video.simpleSync"
                            :advancedSync="video.advancedSync"
                            @update:syncMethod="video.syncMethod = $event"
                            @update:simpleSync="video.simpleSync = $event"
                            @update:advancedSync="video.advancedSync = $event"
                        />

                        <button class="btn btn-primary" @click.prevent="saveYoutube(video)">Save</button>
                    </div>

                    <div class="buttons">
                        <div class="btn-group">
                            <button class="btn btn-danger" @click="removeYoutube(video)">Remove</button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="mb-5">
                <h3 class="mb-5">Audio files</h3>

                <div class="mb-5">
                    <div v-for="audio in audioList" class="audio-item mb-3 pb-3" :key="audio.id">
                        <div>
                            <div class="mb-2">
                                <audio :src="getAudioURL(tabID, audio.filename)" controls></audio>
                            </div>

                            <a :href="getAudioURL(tabID, audio.filename)" target="_blank">{{ audio.filename }}</a>
                        </div>
                        <div class="info">
                            <SyncOptions
                                :syncMethod="audio.syncMethod"
                                :simpleSync="audio.simpleSync"
                                :advancedSync="audio.advancedSync"
                                @update:syncMethod="audio.syncMethod = $event"
                                @update:simpleSync="audio.simpleSync = $event"
                                @update:advancedSync="audio.advancedSync = $event"
                            />
                            <button class="btn btn-primary" @click.prevent="saveAudio(audio)">Save</button>
                        </div>
                        <div class="buttons">
                            <div class="btn-group">
                                <button class="btn btn-danger" @click="removeAudio(audio)">Remove</button>
                            </div>
                        </div>
                    </div>
                </div>

                <Vue3Dropzone
                    v-model="audioFiles"
                    :maxFileSize="100"
                    @error="dropzoneError"
                >
                    <template #placeholder-img>&nbsp;
                    </template>
                    <template #title>
                        Drop your audio file here
                    </template>
                    <template #description>
                        Formats: mp3, ogg
                    </template>
                </Vue3Dropzone>

                <button @click="uploadAudio" class="btn btn-primary w-100 mt-4">Upload</button>
            </div>
        </div>

        <!-- Tab File Page -->
        <div v-else-if='this.page === "tab-file"' class="mb-5">
            <h2 class="mt-4 mb-4">Method 1: Direct Edit</h2>
            <p>
                If you can access the file system, you can edit/replace the tab directly, the path is:<br />
                <strong>{{ filePath }}</strong>
            </p>

            <h2 class="mt-4 mb-4">Method 2: Upload and replace the tab file</h2>

            <Vue3Dropzone
                v-model="tabFiles"
                :maxFileSize="100"
                :accept="supportedFormatCommaString"
                @error="dropzoneError"
            >
                <template #title>
                    Drop your tab here
                </template>
                <template #description> </template>
            </Vue3Dropzone>

            <button @click="uploadTab" class="btn btn-primary w-100 mt-4">Upload</button>
        </div>
    </div>
</template>

<style scoped lang="scss">
.menu {
    display: flex;
    gap: 10px;

    a {
        //text-decoration: underline;
    }
}

.youtube-item, .audio-item {
    display: flex;
    gap: 15px;
    align-items: flex-start;
    border-bottom: 1px solid #333;
    .info {
        flex-grow: 1;
    }
    .buttons {
        align-self: center;
    }
}
</style>

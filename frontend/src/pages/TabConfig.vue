<script>
import { defineComponent } from "vue";
import { baseURL, checkFetch, convertAlphaTexSyncPoint, generalError } from "../app.js";
import { notify } from "@kyvg/vue3-notification";
import Vue3Dropzone from "@jaxtheprime/vue3-dropzone";
import { supportedAudioFormatCommaString, supportedFormatCommaString } from "../../../backend/common.js";
import SyncOptions from "../components/SyncOptions.vue";
import { FontAwesomeIcon } from "../icon.ts";

const alphaTab = await import("@coderline/alphatab");

export default defineComponent({
    components: { SyncOptions, Vue3Dropzone, FontAwesomeIcon },
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
            isLoading: true,
            isUploading: false,
            showOpenButtons: false,
            separateBusy: false,
            separateJob: null,
            separatePollTimer: null,
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

        // Resume polling if a separation job is already running (e.g. page reload)
        try {
            const status = await this.getSeparateStatus();
            if (status.busy) {
                this.startSeparatePolling();
            }
        } catch (e) {
            // Ignore, the user can still press the button
        }

        //this.isLocalIP = !!isPrivateIP(window.location.hostname);
    },
    beforeUnmount() {
        this.stopSeparatePolling();
    },
    methods: {
        async load() {
            this.isLoading = true;
            try {
                const res = await fetch(baseURL + `/api/tab/${this.tabID}`, {
                    credentials: "include",
                });
                await checkFetch(res);
                const data = await res.json();
                this.tab = data.tab;
                this.youtubeList = data.youtubeList;
                this.audioList = data.audioList;
                this.filePath = data.filePath;
                this.showOpenButtons = data.showOpenButtons;
            } finally {
                this.isLoading = false;
            }
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
            this.isUploading = true;
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
            } finally {
                this.isUploading = false;
            }
        },

        async uploadAudio() {
            this.isUploading = true;
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
                this.$refs.audioDropzone.clearFiles();
                await this.load();
            } catch (error) {
                notify({
                    text: error.message,
                    type: "error",
                });
            } finally {
                this.isUploading = false;
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

        async getSeparateStatus() {
            const res = await fetch(baseURL + "/api/separate/status", {
                credentials: "include",
            });
            await checkFetch(res);
            return await res.json();
        },

        /**
         * Whether the filename is already a separated stem (e.g. song_bass.ogg)
         * or a muted mix (e.g. song_muted-bass.ogg). Those are outputs of the
         * separation feature and cannot be separated again.
         */
        isSeparatedStem(filename) {
            return /_(bass|guitar|drums|muted-(bass|guitar|drums))(\.[^.]+)?$/.test(filename);
        },

        async separateAudio(audio) {
            await this.startSeparationJob(
                audio,
                "Separate this audio into bass, drums and guitar tracks?",
                "separate",
                {},
            );
        },

        async muteAudio(audio, stem) {
            await this.startSeparationJob(
                audio,
                `Mute the ${stem} track? This creates a new audio file without it.`,
                "mute",
                { stem },
            );
        },

        /**
         * Common flow for starting a separation (or mute) job: confirm, check
         * the server is not busy, ask for the AI model download consent, then
         * POST to the matching endpoint and begin polling.
         */
        async startSeparationJob(audio, confirmText, operation, extraBody) {
            if (this.separateBusy) {
                return;
            }

            const confirmed = confirm(
                confirmText + "\n\nThis may take a few minutes and will use high CPU/RAM while running.",
            );
            if (!confirmed) {
                return;
            }

            let status;
            try {
                status = await this.getSeparateStatus();
            } catch (e) {
                generalError(e);
                return;
            }

            if (status.busy) {
                notify({
                    text: "Another separation task is already in progress. Please wait for it to finish.",
                    type: "error",
                });
                return;
            }

            let downloadModel = false;
            const missing = [];
            if (!status.modelInstalled) {
                missing.push("- htdemucs_6s_fp16weights.onnx (~136 MB)");
            }
            if (!status.ortInstalled) {
                missing.push("- onnxruntime-node v1.27.0 (~96 MB)");
            }
            if (missing.length > 0) {
                const agree = confirm(
                    "The AI model / runtime is not downloaded yet.\n\n" +
                        "Files to download:\n" +
                        missing.join("\n") +
                        "\n\nDownload them now?",
                );
                if (!agree) {
                    return;
                }
                downloadModel = true;
            }

            try {
                const tabID = this.tab.id;
                const encoded = encodeURIComponent(audio.filename);
                const res = await fetch(baseURL + `/api/tab/${tabID}/audio/${encoded}/${operation}`, {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ downloadModel, ...extraBody }),
                });
                await checkFetch(res);
                this.startSeparatePolling();
            } catch (e) {
                generalError(e);
            }
        },

        startSeparatePolling() {
            this.separateBusy = true;
            this.separateJob = null;

            const poll = async () => {
                let status;
                try {
                    status = await this.getSeparateStatus();
                } catch (e) {
                    this.stopSeparatePolling();
                    generalError(e);
                    return;
                }
                this.separateJob = status.job;
                if (status.busy) {
                    return;
                }
                this.stopSeparatePolling();

                const job = status.job;
                if (job && job.phase === "done") {
                    const names = Object.values(job.result || {}).map((p) => p.split(/[\\/]/).pop());
                    const isMute = job.operation === "mute";
                    notify({
                        text: (isMute ? "Mute completed: " : "Separation completed: ") + names.join(", "),
                        type: "success",
                    });
                    await this.load();
                } else if (job && job.phase === "error") {
                    notify({
                        text: (job.operation === "mute" ? "Mute failed: " : "Separation failed: ") + (job.error || "Unknown error"),
                        type: "error",
                    });
                }
            };

            poll();
            this.separatePollTimer = setInterval(poll, 5000);
        },

        stopSeparatePolling() {
            if (this.separatePollTimer) {
                clearInterval(this.separatePollTimer);
                this.separatePollTimer = null;
            }
            this.separateBusy = false;
        },

        separatePhaseLabel() {
            if (!this.separateJob) {
                return "";
            }
            const isMute = this.separateJob.operation === "mute";
            switch (this.separateJob.phase) {
                case "download":
                    return "Downloading AI model";
                case "decode":
                    return "Decoding";
                case "separate":
                    return isMute ? `Muting ${this.separateJob.stem} track` : "Separating tracks";
                case "encode":
                    return "Encoding";
                case "done":
                    return "Done";
                case "error":
                    return "Failed";
                default:
                    return this.separateJob.phase;
            }
        },

        separatePercent() {
            const job = this.separateJob;
            if (!job) {
                return 100;
            }
            if (typeof job.overall === "number") {
                return Math.min(100, Math.max(0, Math.round(job.overall)));
            }
            if (job.total <= 0) {
                return 100;
            }
            return Math.min(100, Math.round((job.current / job.total) * 100));
        },

        formatEta(ms) {
            if (!ms || ms <= 0) {
                return "";
            }
            const totalSeconds = Math.round(ms / 1000);
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
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

        async openFolder() {
            try {
                const res = await fetch(baseURL + `/api/tab/${this.tabID}/open-folder`, {
                    method: "POST",
                    credentials: "include",
                });
                await checkFetch(res);
                notify({ text: "Opened folder in file manager", type: "success" });
            } catch (e) {
                notify({ text: e.message || e, type: "error" });
            }
        },

        async openExternal() {
            try {
                const res = await fetch(baseURL + `/api/tab/${this.tabID}/open-external`, {
                    method: "POST",
                    credentials: "include",
                });
                await checkFetch(res);
                notify({ text: "Opened with external application", type: "success" });
            } catch (e) {
                notify({ text: e.message || e, type: "error" });
            }
        },
    },
});
</script>

<template>
    <div class="my-container container" v-if="!isLoading">
        <div class="mt-4 mb-4">
            <router-link :to="`/tab/${tab.id}`" class="btn btn-primary">
                <font-awesome-icon :icon='["fas", "arrow-left"]' />
                Back to Tab
            </router-link>

            <button class="btn btn-secondary ms-2" @click.prevent="openFolder" v-if="showOpenButtons">
                <font-awesome-icon :icon='["fas", "folder"]' />
                Open Folder
            </button>

            <button class="btn btn-secondary ms-2" @click.prevent="openExternal" v-if="showOpenButtons">
                <font-awesome-icon :icon='["fas", "file"]' />
                Edit with External Tool...
            </button>

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
                            <div v-if="!isSeparatedStem(audio.filename)">
                                <div class="btn-group mb-3">
                                    <button
                                        class="btn btn-outline-secondary"
                                        @click.prevent="separateAudio(audio)"
                                        :disabled="separateBusy"
                                    >
                                        Separate Bass/Drums/Guitar
                                    </button>
                                    <button
                                        class="btn btn-outline-secondary"
                                        @click.prevent="muteAudio(audio, 'bass')"
                                        :disabled="separateBusy"
                                    >
                                        Mute Bass
                                    </button>
                                    <button
                                        class="btn btn-outline-secondary"
                                        @click.prevent="muteAudio(audio, 'guitar')"
                                        :disabled="separateBusy"
                                    >
                                        Mute Guitar
                                    </button>
                                </div>

                                <div
                                    v-if="separateBusy && separateJob && separateJob.filename === audio.filename"
                                    class="mb-3 separate-progress"
                                >
                                    <div class="mb-1">
                                        {{ separatePhaseLabel() }}<template v-if="typeof separateJob.overall === 'number'"> ({{ separatePercent() }}%)</template>
                                    </div>
                                    <div class="progress">
                                        <div
                                            class="progress-bar progress-bar-striped progress-bar-animated"
                                            :style="{ width: separatePercent() + '%' }"
                                        ></div>
                                    </div>
                                    <div class="text-muted small mt-1" v-if="separateJob.etaMs > 0">
                                        Estimated time remaining: {{ formatEta(separateJob.etaMs) }}
                                    </div>
                                </div>
                            </div>
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
                    ref="audioDropzone"
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
                        Formats: mp3, ogg, flac (flac will be converted to ogg)
                    </template>
                </Vue3Dropzone>

                <button
                    @click="uploadAudio"
                    class="btn btn-primary w-100 mt-4"
                    :disabled="isUploading"
                >
                    {{ isUploading ? "Uploading..." : "Upload" }}
                </button>
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
                :maxFileSize="500"
                @error="dropzoneError"
            >
                <template #title>
                    Drop your tab here
                </template>
                <template #description>Supports {{ supportedFormatCommaString }}</template>
            </Vue3Dropzone>

            <button
                @click="uploadTab"
                class="btn btn-primary w-100 mt-4"
                :disabled="isUploading"
            >
                {{ isUploading ? "Uploading..." : "Upload" }}
            </button>
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

.youtube-item,
.audio-item {
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

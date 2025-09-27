<script>
import { defineComponent } from "vue";
import {baseURL, checkFetch, convertAlphaTexSyncPoint, generalError} from "../app.js";
import { notify } from "@kyvg/vue3-notification";

export default defineComponent({
    data() {
        return {
            tabID: -1,
            tab: {},
            page: "",
            youtubeURL: "",
            youtubeList: [],
            is127001ip: false,
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
        
        // Check if 127.0.0.1
        this.is127001ip = window.location.hostname === "127.0.0.1";
    },
    methods: {
        async load() {
            const res = await fetch(baseURL + `/api/tab/${this.tabID}`, {
                credentials: "include",
            });
            await checkFetch(res);
            const data = await res.json();
            console.log(data)
            this.tab = data.tab;
            this.youtubeList = data.youtubeList;
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
                })
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
        }
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
        <div v-if="this.page === 'info'">
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
        <div v-else-if="this.page === 'audio'">
            <h2 class="mt-4 ">Youtube & Audio files</h2>
    
            <!-- Show alert if 127.0.0.1 -->
            <div v-if="is127001ip" class="alert alert-warning" role="alert">
                Youtube videos may not work on 127.0.0.1 hostname. Please use <strong>localhost</strong> or other hostname.
            </div>

            <div class="mb-3">
                <label for="basic-url" class="form-label">Youtube URL</label>
                <div class="input-group">
                    <input type="text" class="form-control" id="basic-url" placeholder="" v-model="youtubeURL">
                    <button class="btn btn-primary" type="button" @click.prevent="addYoutube()">Add</button>
                </div>
            </div>
            
            <div class="mb-4">
                <h3>Youtube</h3>
                
                <!-- Youtube Item -->
                <div v-for="video in youtubeList" :key="video.id" class="mb-3 pb-5 youtube-item">

                    <iframe width="355" height="200" :src="`https://www.youtube.com/embed/${video.videoID}`" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
                    
                    <div class="info">
                        <div class="mb-3">
                            <strong>Video ID:</strong> <a :href="`https://www.youtube.com/watch?v=${video.videoID}`" target="_blank">{{video.videoID}}</a>
                        </div>

                        <select class="form-control mb-3"  v-model="video.syncMethod">
                            <option value="simple">Simple Sync</option>
                            <option value="advanced">Advanced Sync</option>
                        </select>
                        
                        <div v-if="video.syncMethod === 'simple'" class="mb-3">
                            1st Bar Start Point (start at {{ video.simpleSync }} milliseconds)

                            <div class="my-2 text-info">
                                Perfect for songs with a consistent tempo and the tab have a correct bpm.
                            </div>
                            
                            <input type="number" class="form-control" v-model="video.simpleSync">
                        </div>
                        
                        <div v-if="video.syncMethod === 'advanced'" class="mb-3">
                            Advanced Sync Points
                            
                            <div class="my-2 text-info">
                                <p>
                                    You can use this to sync the song bar by bar.
                                </p>
                                <p>
                                    \sync BarIndex Occurence MillisecondOffset
                                </p>
                                <p>Go to <a href="https://alphatab.net/docs/playground" target="_blank">https://alphatab.net/docs/playground</a>, and generate alphaTex Sync Points.</p>

                            </div>
                            
                            <textarea class="form-control" rows="10" v-model="video.advancedSync" :placeholder="'Example:\n'+
'\\sync 0 0 36\n'+
'\\sync 16 0 35425'">
                            </textarea>
                        </div>
                        
                        <button class="btn btn-primary" @click.prevent="saveYoutube(video)">Save</button>
                        
                    </div>
                    
                    <div>
                        <div class="btn-group">
                            <button class="btn btn-danger" @click="removeYoutube(video)">Remove</button>
                        </div>
                    </div>
                    
                </div>
                
            </div>
            
            <div>
                <h3>Audio files</h3>
            </div>
            
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

.youtube-item {
    display: flex;
    gap: 15px;
    align-items: center;
    border-bottom: 1px solid #333;
    
    .info {
        flex-grow: 1;
    }
}
</style>

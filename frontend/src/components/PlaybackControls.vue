<script setup>
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";

const props = defineProps({
    playing: {
        type: Boolean,
        required: true,
    },
    isLooping: {
        type: Boolean,
        required: true,
    },
    enableCountIn: {
        type: Boolean,
        required: true,
    },
    enableMetronome: {
        type: Boolean,
        required: true,
    },
    speed: {
        type: Number,
        required: true,
    },
    playbackRange: {
        default: null,
    },
    currentAudio: {
        type: String,
        required: true,
    },
});

const emit = defineEmits([
    "play-pause",
    "play-from-highlighted",
    "toggle-loop",
    "toggle-count-in",
    "toggle-metronome",
    "update:speed",
]);
</script>

<template>
    <button class="btn btn-warning" @click="emit('play-from-highlighted')" v-if="playbackRange">
        <font-awesome-icon :icon='["fas", "play"]' />
        Restart
    </button>

    <button class="btn btn-primary" @click="emit('play-pause')" :class="{ active: playing }">
        <span v-if="!playing">
            <font-awesome-icon :icon='["fas", "play"]' />
            Play
        </span>
        <span v-else>
            <font-awesome-icon :icon='["fas", "pause"]' />
            Pause
        </span>
    </button>

    <button class="btn btn-secondary" @click="emit('toggle-loop')" :class="{ active: isLooping }">
        <font-awesome-icon :icon='["fas", "check"]' v-if="isLooping" />
        Loop
    </button>

    <button class="btn btn-secondary" @click="emit('toggle-count-in')" :class='{ active: enableCountIn, disabled: currentAudio !== "synth" }'>
        <font-awesome-icon :icon='["fas", "check"]' v-if="enableCountIn" />
        Count in
    </button>

    <button class="btn btn-secondary" @click="emit('toggle-metronome')" :class='{ active: enableMetronome, disabled: currentAudio !== "synth" }'>
        <font-awesome-icon :icon='["fas", "check"]' v-if="enableMetronome" />
        Metronome
    </button>

    <div class="select-percentage">
        Speed: <input type="number" class="form-control" min="0" max="1000" step="1" :value="speed" @input="emit('update:speed', Number($event.target.value))" /> (%)
    </div>
</template>

<style scoped lang="scss">
.select-percentage {
    display: flex;
    align-items: center;
    gap: 4px;

    input {
        min-width: 90px;
        border: 0;
    }
}
</style>

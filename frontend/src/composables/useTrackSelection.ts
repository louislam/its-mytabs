import { ref, type Ref } from "vue";

const alphaTab = await import("@coderline/alphatab");

export function useTrackSelection(
    api: Ref<InstanceType<typeof alphaTab.AlphaTabApi> | undefined>,
    loadFn: (trackID: number) => Promise<void>,
    setConfig: (key: string, value: any) => void,
    closeAllList: () => void,
) {
    const selectedTrack = ref(0);
    const soloTrackID = ref(-1);
    const muteTrackList = ref<Record<number, boolean>>({});
    const showTrackList = ref(false);

    function isDrum() {
        if (!api.value || !api.value.score || !api.value.score.tracks) {
            return false;
        }
        const track = api.value.score.tracks[selectedTrack.value];
        return track.playbackInfo.program === 0;
    }

    function hasBackingTrack() {
        return !!api.value?.score?.backingTrack;
    }

    async function changeTrack(trackID: number) {
        const fromDrum = isDrum();
        selectedTrack.value = trackID;
        const toDrum = isDrum();

        // If switching from/to drum track, need to re-render the whole score
        // Due to the bug that Drum is not able to render in Tab View
        if (fromDrum || toDrum) {
            await loadFn(trackID);
        } else {
            api.value!.renderTracks([api.value!.score.tracks[trackID]]);
            setConfig("trackID", trackID);
        }

        closeAllList();
    }

    function toggleSolo(trackID: number) {
        if (!api.value) {
            return;
        }

        if (soloTrackID.value === trackID) {
            api.value.changeTrackMute(api.value.score.tracks, false);
            soloTrackID.value = -1;
            muteTrackList.value = {};
        } else {
            const muteList: any[] = [];
            const soloList: any[] = [];

            for (const track of api.value.score.tracks) {
                if (track.index !== trackID) {
                    muteList.push(track);
                    muteTrackList.value[track.index] = true;
                } else {
                    soloList.push(track);
                    muteTrackList.value[track.index] = false;
                }
            }

            api.value.changeTrackMute(muteList, true);
            api.value.changeTrackMute(soloList, false);

            soloTrackID.value = trackID;
        }
    }

    function toggleMute(trackID: number) {
        soloTrackID.value = -1;

        muteTrackList.value[trackID] = !muteTrackList.value[trackID];

        const mute = muteTrackList.value[trackID];

        api.value!.changeTrackMute([
            api.value!.score.tracks[trackID],
        ], mute);
    }

    function toggleVolume(trackID: number, volume: number) {
        if (!api.value) {
            return;
        }
        const track = api.value.score.tracks.find(({ index }: any) => index === trackID);
        api.value.changeTrackVolume(track, volume / 100);
    }

    return {
        selectedTrack,
        soloTrackID,
        muteTrackList,
        showTrackList,
        isDrum,
        hasBackingTrack,
        changeTrack,
        toggleSolo,
        toggleMute,
        toggleVolume,
    };
}

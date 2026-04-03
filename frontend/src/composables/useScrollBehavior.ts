import { type Ref } from "vue";

const alphaTab = await import("@coderline/alphatab");
const { ScrollMode } = alphaTab;

export type ScrollModeType = typeof ScrollMode[keyof typeof ScrollMode];

export function useScrollBehavior(scrollMode: Ref<ScrollModeType>, api: Ref<InstanceType<typeof alphaTab.AlphaTabApi> | undefined>) {
    function applyScrollMode() {
        if (api.value) {
            api.value.settings.player.scrollMode = scrollMode.value;
            api.value.updateSettings();
        }
    }

    return { scrollMode, applyScrollMode, ScrollMode };
}

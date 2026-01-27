import * as alphaTab from "@coderline/alphatab";
export type Bar = alphaTab.model.Bar;

export enum KeySignatureMinor {
    Abm = -7,
    Ebm = -6,
    Bbm = -5,
    Fm = -4,
    Cm = -3,
    Gm = -2,
    Dm = -1,
    Am = 0,
    Em = 1,
    Bm = 2,
    FSharpm = 3,
    CSharpm = 4,
    GSharpm = 5,
    DSharpm = 6,
    ASharpm = 7,
}

export function getKeySignature(bar: Bar): string {
    // "Major" or "Minor"
    const type = alphaTab.model.KeySignatureType[bar.keySignatureType];

    let key: string = "";
    if (bar.keySignatureType == alphaTab.model.KeySignatureType.Major) {
        key = alphaTab.model.KeySignature[bar.keySignature];
    } else {
        key = KeySignatureMinor[bar.keySignature];
    }

    key = key.replace("Sharp", "#");
    return `${key} (${type})`;
}

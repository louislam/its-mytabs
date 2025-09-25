export const supportedFormatList = [
    "gp",
    "gpx",
    "gp3",
    "gp4",
    "gp5",
    "musicxml",
    "capx",
];

/**
 * Supported format string for display, like ".gp, .gpx, .gp3, ..." (with dot)
 */
export const supportedFormatCommaString = supportedFormatList.map((ext) => {
    return "." + ext;
}).join(", ");

export const midiProgramCodeList = {
    24: "Acoustic Guitar (nylon)",
    25: "Acoustic Guitar (steel)",
    26: "Electric Guitar (jazz)",
    27: "Electric Guitar (clean)",
    28: "Electric Guitar (muted)",
    29: "Overdriven Guitar",
    30: "Distortion Guitar",
    31: "Guitar Harmonics",
    32: "Acoustic Bass",
    33: "Electric Bass (finger)",
    34: "Electric Bass (pick)",
    35: "Fretless Bass",
    36: "Slap Bass 1",
    37: "Slap Bass 2",
    38: "Synth Bass 1",
    39: "Synth Bass 2",
};

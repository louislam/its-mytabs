export const supportedFormatList = [
    'gp',
    'gpx',
    'gp3',
    'gp4',
    'gp5',
    'musicxml',
    'capx',
]

/**
 * Supported format string for display, like ".gp, .gpx, .gp3, ..." (with dot)
 */
export const supportedFormatCommaString = supportedFormatList.map((ext) => {
    return "." + ext
}).join(", ");

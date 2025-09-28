import { library } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";

// Add Free Font Awesome Icons
// https://fontawesome.com/v7/search?ic=free&o=r
// In order to add an icon, you have to:
// 1) add the icon name in the import statement below;
// 2) add the icon name to the library.add() statement below.
import { faArrowRightFromBracket, faArrowRightToBracket, faCheck, faFile, faFolder, faGear, faPause, faPlay, faPlus, faXmark } from "@fortawesome/free-solid-svg-icons";

library.add([
    faFile,
    faFolder,
    faGear,
    faArrowRightFromBracket,
    faPlus,
    faPlay,
    faPause,
    faCheck,
    faXmark,
    faArrowRightToBracket,
]);

export { FontAwesomeIcon };

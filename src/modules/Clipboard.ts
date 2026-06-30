/**
 * Worker-safe re-export surface for clipboard helpers (canonical: `fest/lure` Clipboard module).
 * INVARIANT: keep `core/modules/Clipboard` aligned with lur.e exports used by CRX + shell.
 */
export {
    initClipboardReceiver,
    readText,
    toText,
    writeHTML,
    writeText,
} from "fest/lure";

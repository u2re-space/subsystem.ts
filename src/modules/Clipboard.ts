/**
 * Canonical forwarding module for `core/modules/Clipboard` imports (CRX SW, PWA, overlays).
 * Physical implementation lives in lur.e extension clipboard helpers.
 */
export {
    writeText,
    writeHTML,
    writeImage,
    readText,
    toText,
    requestCopy,
    listenForClipboardRequests,
    initClipboardReceiver,
    requestCopyViaCRX,
    isChromeExtension,
    isClipboardAvailable,
    isClipboardWriteAvailable,
    COPY_HACK,
    copyWithResult,
    type ClipboardDataType,
    type ClipboardWriteOptions,
    type ClipboardResult,
    type CRXCopyOptions
} from "fest/lure";

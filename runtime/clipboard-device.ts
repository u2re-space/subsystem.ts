/**
 * Vite/runtime alias target for `shared/native/clipboard-device`.
 * Re-exports the canonical Capacitor + web clipboard bridge.
 */
export {
    isNativeClipboardShell,
    isCapacitorNativeShell,
    writeClipboardTextToDevice,
    readClipboardTextFromDevice,
    writeClipboardImageToDevice,
    openNativeNotificationSettings,
    openAppClipboardRelatedSettings,
} from "../src/routing/native/clipboard-device";

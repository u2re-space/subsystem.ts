/**
 * Device clipboard I/O: prefers Capacitor on cwsp Android, else Web Clipboard API.
 * Used for LAN clipboard sync (CWSAndroid-style) from WebSocket / coordinator.
 */

const isCapacitorNative = (): boolean => {
    try {
        const c = (globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
        return typeof c?.isNativePlatform === "function" && Boolean(c.isNativePlatform());
    } catch {
        return false;
    }
};

export const isNativeClipboardShell = (): boolean => isCapacitorNative();

/** Same check — use when "clipboard" naming is misleading (e.g. AirPad WebSocket transport). */
export const isCapacitorNativeShell = (): boolean => isCapacitorNative();

export async function writeClipboardTextToDevice(text: string): Promise<void> {
    const value = String(text ?? "");
    if (isCapacitorNative()) {
        try {
            const { Clipboard } = await import(/* @vite-ignore */ "@capacitor/clipboard");
            await Clipboard.write({ string: value });
            return;
        } catch {
            // fall through to web
        }
    }
    if (globalThis.navigator?.clipboard?.writeText) {
        await globalThis.navigator.clipboard.writeText(value);
        return;
    }
    throw new Error("Clipboard write unavailable");
}

export async function readClipboardTextFromDevice(): Promise<string> {
    if (isCapacitorNative()) {
        try {
            const { Clipboard } = await import(/* @vite-ignore */ "@capacitor/clipboard");
            const res = await Clipboard.read();
            const v = (res as { value?: string } | null)?.value;
            if (typeof v === "string") return v;
        } catch {
            // fall through
        }
    }
    if (globalThis.navigator?.clipboard?.readText) {
        return String(await globalThis.navigator.clipboard.readText());
    }
    throw new Error("Clipboard read unavailable");
}

/** Opens notification settings for this app (Android / iOS). Best-effort. */
export async function openNativeNotificationSettings(): Promise<void> {
    if (!isCapacitorNative()) return;
    try {
        const { NativeSettings, AndroidSettings, IOSSettings } = await import(/* @vite-ignore */ "capacitor-native-settings");
        await NativeSettings.open({
            optionAndroid: AndroidSettings.AppNotification,
            optionIOS: IOSSettings.AppNotification
        });
    } catch {
        // ignore
    }
}

/** Opens system UI where the user can adjust app permissions (Android / iOS). Best-effort. */
export async function openAppClipboardRelatedSettings(): Promise<void> {
    if (!isCapacitorNative()) return;
    try {
        const { NativeSettings, AndroidSettings, IOSSettings } = await import(/* @vite-ignore */ "capacitor-native-settings");
        await NativeSettings.open({
            optionAndroid: AndroidSettings.ApplicationDetails,
            optionIOS: IOSSettings.App
        });
    } catch {
        // ignore
    }
}

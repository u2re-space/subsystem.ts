/**
 * Capacitor runtime permission bootstrap (web-safe, no static plugin imports).
 *
 * Uses the native {@code CwsPlatform} Capacitor plugin (patched into the Android
 * project by `tools/patch-capacitor-android.mjs`) plus clipboard warm-up.
 */

type AnyRecord = Record<string, any>;

const cap = (): AnyRecord | null => {
    try {
        const c = (globalThis as any)?.Capacitor;
        return c && typeof c === "object" ? (c as AnyRecord) : null;
    } catch {
        return null;
    }
};

export const isCapacitorNative = (): boolean => {
    const c = cap();
    try {
        return Boolean(c?.isNativePlatform?.() ?? (c?.platform && c.platform !== "web"));
    } catch {
        return false;
    }
};

const plugin = (name: string): AnyRecord | null => {
    const c = cap();
    const p = c?.Plugins?.[name];
    return p && typeof p === "object" ? (p as AnyRecord) : null;
};

const callSafe = async (fn: any, ...args: unknown[]): Promise<unknown> => {
    try {
        return typeof fn === "function" ? await fn(...args) : undefined;
    } catch {
        return undefined;
    }
};

let requested = false;

/**
 * Request Android runtime permissions the CWSP shell relies on. Idempotent;
 * safe to call from shell mount.
 */
export const ensureCapacitorPermissions = async (): Promise<{ native: boolean; requested: string[] }> => {
    if (!isCapacitorNative()) return { native: false, requested: [] };
    if (requested) return { native: true, requested: [] };
    requested = true;

    const done: string[] = [];

    const clip = plugin("Clipboard");
    if (clip) {
        await callSafe(clip.read);
        done.push("clipboard");
    }

    const platform = plugin("CwsPlatform");
    if (platform) {
        await callSafe(platform.requestRuntimePermissions);
        done.push("CwsPlatform.requestRuntimePermissions");
    } else {
        const legacy = plugin("DevicePermissions") || plugin("Permissions");
        if (legacy && typeof legacy.requestPermissions === "function") {
            await callSafe(legacy.requestPermissions, {
                permissions: ["POST_NOTIFICATIONS"]
            });
            done.push("legacy-permissions");
        }
    }

    const notif = plugin("LocalNotifications");
    if (notif && typeof notif.requestPermissions === "function") {
        await callSafe(notif.requestPermissions);
        done.push("notifications");
    }

    return { native: true, requested: done };
};

/** Open Android overlay (draw over apps) settings — user gesture from Settings UI. */
export const openCapacitorOverlaySettings = async (): Promise<boolean> => {
    const platform = plugin("CwsPlatform");
    if (!platform || typeof platform.openOverlaySettings !== "function") return false;
    await callSafe(platform.openOverlaySettings);
    return true;
};

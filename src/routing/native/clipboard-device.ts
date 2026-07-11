/**
 * Device clipboard I/O: desktop control host → CwsBridge Java → Capacitor → Web API.
 *
 * WHY desktop-first: Neutralino/WebNative WebView `navigator.clipboard` is unreliable
 * for system clipboard (esp. images / background). The Node control host exposes
 * ClipboardService at `/service/clipboard` with the same `__WEBNATIVE_AUTH__` as settings.
 */

import { readCapacitorClipboardText, writeCapacitorClipboardText } from "./capacitor-clipboard";
import { invokeCwsNative, isCapacitorCwsNativeShell } from "com/routing/native/cws-bridge";

interface DesktopControlAuth {
    port: number;
    key: string;
}

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

/** Loopback Neutralino/WebNative control auth (settings + clipboard share this). */
const readDesktopControlAuth = (): DesktopControlAuth | null => {
    try {
        const g = globalThis as unknown as {
            __WEBNATIVE_AUTH__?: { port?: number; key?: string };
            __NEUTRALINO_AUTH__?: { port?: number; key?: string };
            __CWS_WEBNATIVE_BOOT__?: boolean;
            __CWS_NEUTRALINO_BOOT__?: boolean;
        };
        const auth = g.__WEBNATIVE_AUTH__ || g.__NEUTRALINO_AUTH__;
        if (!auth || typeof auth.port !== "number") return null;
        // Prefer surfaces that already marked desktop boot, but accept auth alone.
        if (!(g.__CWS_WEBNATIVE_BOOT__ || g.__CWS_NEUTRALINO_BOOT__ || auth.key)) {
            /* still allow when key present */
        }
        if (!auth.key) return null;
        return { port: auth.port, key: String(auth.key) };
    } catch {
        return null;
    }
};

const desktopControlFetch = async <T = unknown>(
    path: string,
    init?: RequestInit
): Promise<T | null> => {
    const auth = readDesktopControlAuth();
    if (!auth) return null;
    try {
        const headers = new Headers(init?.headers);
        headers.set("Content-Type", "application/json");
        headers.set("X-API-Key", auth.key);
        const res = await fetch(`http://127.0.0.1:${auth.port}${path}`, {
            ...init,
            headers,
            cache: "no-store"
        });
        if (!res.ok) return null;
        return (await res.json()) as T;
    } catch {
        return null;
    }
};

const extractBridgeClipboardText = (result: unknown): string => {
    if (!result || typeof result !== "object") return "";
    const record = result as Record<string, unknown>;
    const echo = record.echo;
    if (echo && typeof echo === "object") {
        const echoRec = echo as Record<string, unknown>;
        if (typeof echoRec.text === "string") return echoRec.text;
        if (typeof echoRec.value === "string") return echoRec.value;
    }
    if (typeof record.text === "string") return record.text;
    if (typeof record.value === "string") return record.value;
    if (typeof record.data === "string") return record.data;
    return "";
};

async function readViaDesktopControl(): Promise<string | null> {
    const result = await desktopControlFetch<{
        ok?: boolean;
        text?: string;
        data?: string;
        content?: string;
    }>("/service/clipboard?kind=text");
    if (!result || result.ok === false) return null;
    const text =
        (typeof result.text === "string" && result.text) ||
        (typeof result.content === "string" && result.content) ||
        (typeof result.data === "string" && result.data) ||
        "";
    // Empty string is a valid clipboard — distinguish from null (unavailable).
    if (result.ok === true || "text" in result || "data" in result) return text;
    return null;
}

async function writeViaDesktopControl(text: string): Promise<boolean> {
    const result = await desktopControlFetch<{ ok?: boolean }>("/service/clipboard", {
        method: "POST",
        body: JSON.stringify({ kind: "text", text, content: text, data: text })
    });
    return Boolean(result && result.ok !== false);
}

async function writeImageViaDesktopControl(
    data: string,
    mimeType: string,
    hash?: string
): Promise<boolean> {
    const result = await desktopControlFetch<{ ok?: boolean }>("/service/clipboard", {
        method: "POST",
        body: JSON.stringify({
            kind: "image",
            mimeType,
            hash: hash || undefined,
            imageBase64: data,
            asset: {
                mimeType,
                hash: hash || undefined,
                data,
                source: "base64"
            }
        })
    });
    return Boolean(result && result.ok !== false);
}

async function readViaCwsBridge(): Promise<string> {
    if (!isCapacitorCwsNativeShell()) return "";
    try {
        const result = await invokeCwsNative("clipboard:read-local", {});
        return extractBridgeClipboardText(result);
    } catch {
        return "";
    }
}

async function writeViaCwsBridgeImage(
    data: string,
    mimeType: string,
    hash?: string
): Promise<boolean> {
    if (!isCapacitorCwsNativeShell()) return false;
    try {
        const result = await invokeCwsNative("clipboard:write-local-image", {
            mimeType,
            hash: hash || "",
            data
        });
        return Boolean((result as { ok?: boolean })?.ok);
    } catch {
        return false;
    }
}

async function writeViaCwsBridge(text: string): Promise<boolean> {
    if (!isCapacitorCwsNativeShell()) return false;
    try {
        const result = await invokeCwsNative("clipboard:write-local", { text });
        return Boolean((result as { ok?: boolean })?.ok);
    } catch {
        return false;
    }
}

export async function writeClipboardImageToDevice(
    data: string,
    mimeType = "image/png",
    hash?: string
): Promise<void> {
    const payload = String(data ?? "").trim();
    if (!payload) throw new Error("Clipboard image payload empty");
    const mime = String(mimeType || "image/png").trim() || "image/png";

    // Desktop Neutralino/WebNative: PowerShell/ClipboardService via control host.
    if (isDesktopControlClipboardShell()) {
        for (let i = 0; i < 4; i++) {
            if (await writeImageViaDesktopControl(payload, mime, hash)) return;
            if (i + 1 < 4) {
                await new Promise((r) => globalThis.setTimeout(r, 120 * (i + 1)));
            }
        }
        throw new Error("Desktop control clipboard image write failed");
    }

    if (await writeImageViaDesktopControl(payload, mime, hash)) return;

    if (await writeViaCwsBridgeImage(payload, mime, hash)) return;

    if (isCapacitorNative() && globalThis.navigator?.clipboard?.write) {
        try {
            const bytes = decodeClipboardImageBase64(payload);
            if (bytes?.length) {
                const blob = new Blob([bytes], { type: mime });
                const pngBlob = mime === "image/png" ? blob : await blobToPng(blob);
                await globalThis.navigator.clipboard.write([
                    new ClipboardItem({ [pngBlob.type]: pngBlob })
                ]);
                return;
            }
        } catch {
            /* fall through */
        }
    }
    throw new Error("Clipboard image write unavailable");
}

const decodeClipboardImageBase64 = (raw: string): Uint8Array | null => {
    let data = raw.trim();
    if (!data) return null;
    if (data.startsWith("data:")) {
        const comma = data.indexOf(",");
        if (comma < 0) return null;
        data = data.slice(comma + 1);
    }
    try {
        const bin = globalThis.atob(data.replace(/\s+/g, ""));
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    } catch {
        return null;
    }
};

const blobToPng = async (blob: Blob): Promise<Blob> => {
    if (blob.type === "image/png") return blob;
    if (typeof createImageBitmap === "function" && typeof OffscreenCanvas !== "undefined") {
        const bitmap = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) return blob;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        return await canvas.convertToBlob({ type: "image/png" });
    }
    return blob;
};

/** True when WebView must use Node control host for real OS clipboard (not navigator). */
const isDesktopControlClipboardShell = (): boolean => {
    try {
        const g = globalThis as unknown as {
            __CWS_NEUTRALINO_BOOT__?: boolean;
            __CWS_WEBNATIVE_BOOT__?: boolean;
            __WEBNATIVE_AUTH__?: { port?: number; key?: string };
            __NEUTRALINO_AUTH__?: { port?: number; key?: string };
            NL_OS?: string;
        };
        if (g.__CWS_NEUTRALINO_BOOT__ || g.__CWS_WEBNATIVE_BOOT__) return true;
        if (typeof g.NL_OS === "string") return true;
        const auth = g.__WEBNATIVE_AUTH__ || g.__NEUTRALINO_AUTH__;
        return Boolean(auth && typeof auth.port === "number" && auth.key);
    } catch {
        return false;
    }
};

/**
 * WHY: Neutralino WebView `navigator.clipboard` often reports success without
 * touching the Windows OS clipboard — never treat it as the desktop path.
 */
async function writeViaDesktopControlWithRetry(text: string, attempts = 4): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
        if (await writeViaDesktopControl(text)) return true;
        if (i + 1 < attempts) {
            await new Promise((r) => globalThis.setTimeout(r, 120 * (i + 1)));
        }
    }
    return false;
}

export async function writeClipboardTextToDevice(text: string): Promise<void> {
    const value = String(text ?? "");
    const desktop = isDesktopControlClipboardShell();

    if (desktop) {
        if (await writeViaDesktopControlWithRetry(value)) return;
        throw new Error("Desktop control clipboard write failed");
    }

    if (await writeViaDesktopControl(value)) return;

    if (await writeViaCwsBridge(value)) return;

    if (isCapacitorNative() && (await writeCapacitorClipboardText(value))) return;

    if (globalThis.navigator?.clipboard?.writeText) {
        await globalThis.navigator.clipboard.writeText(value);
        return;
    }
    throw new Error("Clipboard write unavailable");
}

export async function readClipboardTextFromDevice(): Promise<string> {
    const desktop = isDesktopControlClipboardShell();
    if (desktop) {
        for (let i = 0; i < 4; i++) {
            const fromDesktop = await readViaDesktopControl();
            if (fromDesktop !== null) return fromDesktop;
            if (i + 1 < 4) {
                await new Promise((r) => globalThis.setTimeout(r, 120 * (i + 1)));
            }
        }
        throw new Error("Desktop control clipboard read failed");
    }

    const fromDesktop = await readViaDesktopControl();
    if (fromDesktop !== null) return fromDesktop;

    const fromBridge = await readViaCwsBridge();
    if (fromBridge) return fromBridge;

    if (isCapacitorNative()) {
        const fromCapacitor = await readCapacitorClipboardText();
        if (fromCapacitor) return fromCapacitor;
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

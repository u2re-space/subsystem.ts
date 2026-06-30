/**
 * Device clipboard I/O: CwsBridge Java path on CWSP Android, then Capacitor plugins, then Web API.
 */

import { readCapacitorClipboardText, writeCapacitorClipboardText } from "./capacitor-clipboard";
import { invokeCwsNative, isCapacitorCwsNativeShell } from "com/routing/native/cws-bridge";

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
    return "";
};

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

export async function writeClipboardTextToDevice(text: string): Promise<void> {
    const value = String(text ?? "");
    if (await writeViaCwsBridge(value)) return;

    if (isCapacitorNative() && await writeCapacitorClipboardText(value)) return;

    if (globalThis.navigator?.clipboard?.writeText) {
        await globalThis.navigator.clipboard.writeText(value);
        return;
    }
    throw new Error("Clipboard write unavailable");
}

export async function readClipboardTextFromDevice(): Promise<string> {
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

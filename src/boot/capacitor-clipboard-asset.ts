/*
 * Filename: capacitor-clipboard-asset.ts
 * FullPath: apps/CWSP-reborn/src/frontend/submodules/shells/boot/capacitor-clipboard-asset.ts
 * Change date and time: 18.45.00_10.07.2026
 * Reason for changes: Apply native clipboard:asset handoff via navigator.clipboard ClipboardItem.
 */

import { isCapacitorNative } from "./capacitor-permissions";

type AssetDetail = {
    type?: string;
    asset?: {
        hash?: string;
        name?: string;
        mimeType?: string;
        type?: string;
        data?: string;
        uri?: string;
        path?: string;
        source?: string;
    };
    path?: string;
};

let installed = false;

const dataUrlFromAsset = async (asset: NonNullable<AssetDetail["asset"]>): Promise<string | null> => {
    const data = String(asset.data || "").trim();
    if (data.startsWith("data:")) return data;
    const mime = String(asset.mimeType || asset.type || "application/octet-stream");
    if (data && (asset.source === "base64" || /^[A-Za-z0-9+/=]+$/.test(data.slice(0, 64)))) {
        return `data:${mime};base64,${data}`;
    }
    const uri = String(asset.uri || asset.path || "").trim();
    if (uri.startsWith("http://") || uri.startsWith("https://") || uri.startsWith("blob:")) {
        try {
            const res = await fetch(uri);
            const blob = await res.blob();
            return await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ""));
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
            });
        } catch {
            return null;
        }
    }
    return null;
};

/**
 * Listen for native `cws:clipboardAsset` / CwsBridge nativeMessage and write
 * image/file payloads through the WebView ClipboardItem API.
 */
export const installCapacitorClipboardAssetBridge = (): void => {
    if (!isCapacitorNative() || installed) return;
    installed = true;

    const apply = (detail: AssetDetail | null | undefined): void => {
        void (async () => {
            const asset = detail?.asset;
            if (!asset) return;
            const dataUrl = await dataUrlFromAsset(asset);
            if (!dataUrl || !navigator.clipboard?.write) return;
            const mime = String(asset.mimeType || asset.type || "image/png");
            const res = await fetch(dataUrl);
            const blob = await res.blob();
            const item = new ClipboardItem({ [mime]: blob });
            await navigator.clipboard.write([item]);
        })().catch((err) => {
            console.warn("[capacitor-clipboard-asset] apply failed", err);
        });
    };

    window.addEventListener("cws:clipboardAsset", ((ev: Event) => {
        const detail = (ev as CustomEvent<AssetDetail | string>).detail;
        if (typeof detail === "string") {
            try {
                apply(JSON.parse(detail) as AssetDetail);
            } catch {
                /* ignore */
            }
            return;
        }
        apply(detail);
    }) as EventListener);

    // Also accept Capacitor plugin listener payloads when available.
    try {
        const cap = (globalThis as { Capacitor?: { Plugins?: Record<string, any> } }).Capacitor;
        const bridge = cap?.Plugins?.CwsBridge;
        if (bridge?.addListener) {
            void bridge.addListener("nativeMessage", (event: { payload?: AssetDetail }) => {
                if (event?.payload?.type === "clipboard:asset") apply(event.payload);
            });
        }
    } catch {
        /* optional */
    }
};

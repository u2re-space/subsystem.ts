/*
 * Filename: sku-ingress.ts
 * FullPath: modules/projects/subsystem/src/routing/channel/sku-ingress.ts
 * FIND:sku
 * TAG:sku,share-target
 * Change date and time: 17.40.00_27.08.2026
 * Reason for changes: Share-target / launch-queue stay on the receiving SKU (process/document/explorer/shell).
 */

import { inferCwspSkuFromLocation, type CwspSku } from "../../other/config/ecosystem-skus";

export type SkuIngressAction = "open" | "attach" | "process" | "ask" | "shortcut" | "wallpaper";

export type SkuIngressHint = {
    destination: "viewer" | "workcenter" | "explorer" | "home";
    action: SkuIngressAction;
    filename?: string;
    source?: string;
    contentType?: string;
};

type IngressProbe = {
    files?: File[];
    text?: string;
    url?: string;
    title?: string;
    fileCount?: number;
    hint?: { filename?: string; source?: string; destination?: string; action?: string };
};

const WALLPAPER_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"]);
const MIN_WALLPAPER_BYTES = 20 * 1024;
const MAX_WALLPAPER_BYTES = 25 * 1024 * 1024;
const MIN_WALLPAPER_EDGE = 320;
const MAX_WALLPAPER_EDGE = 16384;
const MIN_WALLPAPER_ASPECT = 0.3;
const MAX_WALLPAPER_ASPECT = 3.5;

const fileExt = (name: string): string => {
    const n = String(name || "").trim().toLowerCase();
    const cut = n.lastIndexOf(".");
    return cut > 0 ? n.slice(cut + 1) : "";
};

/** Directory-like path (share URL, launch path, or typed location). */
export const looksLikeDirectoryPath = (raw: string): boolean => {
    const t = String(raw || "").trim();
    if (!t) return false;
    if (/[/\\]$/.test(t)) return true;
    const noQuery = t.split(/[?#]/)[0] || t;
    if (/[/\\]$/.test(noQuery)) return true;
    const base = noQuery.replace(/\\/g, "/");
    const last = base.slice(base.lastIndexOf("/") + 1);
    if (!last) return true;
    if (/\.[a-z0-9]{1,8}$/i.test(last)) return false;
    return /[/\\]/.test(noQuery) || /^(file|content|saf):/i.test(t);
};

/** Sync wallpaper gate — decode still required before paint. */
export const looksLikeWallpaperFile = (file: File | null | undefined): boolean => {
    if (!file) return false;
    const mime = String(file.type || "").toLowerCase();
    const ext = fileExt(file.name);
    const image = mime.startsWith("image/") || WALLPAPER_EXT.has(ext);
    if (!image) return false;
    if (mime.includes("svg") || ext === "svg") return false;
    if (file.size < MIN_WALLPAPER_BYTES || file.size > MAX_WALLPAPER_BYTES) return false;
    return true;
};

/** Decode-time checks: edge length and aspect so icons / strips do not become wallpaper. */
export const isWallpaperCompatible = async (file: File): Promise<boolean> => {
    if (!looksLikeWallpaperFile(file)) return false;
    try {
        const bmp = await createImageBitmap(file);
        const w = bmp.width;
        const h = bmp.height;
        bmp.close?.();
        if (w < MIN_WALLPAPER_EDGE || h < MIN_WALLPAPER_EDGE) return false;
        if (w > MAX_WALLPAPER_EDGE || h > MAX_WALLPAPER_EDGE) return false;
        const aspect = w / h;
        return aspect >= MIN_WALLPAPER_ASPECT && aspect <= MAX_WALLPAPER_ASPECT;
    } catch {
        return false;
    }
};

const firstFile = (payload: IngressProbe): File | undefined => {
    const files = Array.isArray(payload.files) ? payload.files : [];
    return files.find((f): f is File => f instanceof File);
};

const pathProbe = (payload: IngressProbe): string => {
    const hintPath = typeof payload.hint?.source === "string" ? payload.hint.source.trim() : "";
    if (hintPath) return hintPath;
    const url = String(payload.url || "").trim();
    if (url) return url;
    const title = String(payload.title || "").trim();
    if (title && /[/\\]/.test(title)) return title;
    const text = String(payload.text || "").trim();
    if (text && !/\s/.test(text) && /[/\\]/.test(text)) return text;
    return "";
};

/**
 * Receiving SKU owns the share. Hub/CRX fall through to content-based routing.
 * WHY: otherwise process hands text to document, and document hands images to process.
 */
export const skuIngressHint = (
    payload: IngressProbe,
    opts?: { sku?: CwspSku | ""; autoProcessShared?: boolean }
): SkuIngressHint | undefined => {
    const sku = opts?.sku || inferCwspSkuFromLocation();
    if (!sku || sku === "crx" || sku === "transfer") return undefined;

    const file = firstFile(payload);
    const path = pathProbe(payload);
    const filename = payload.hint?.filename || file?.name || "";
    const mime = String(file?.type || "").toLowerCase();
    const kind = mime.startsWith("image/") ? "image" : mime.startsWith("text/") ? "text" : file ? "file" : undefined;

    if (sku === "process") {
        const hinted = payload.hint?.action;
        const action: SkuIngressAction =
            hinted === "attach" || hinted === "process"
                ? hinted
                : opts?.autoProcessShared !== false
                  ? "process"
                  : "attach";
        return {
            destination: "workcenter",
            action,
            filename,
            contentType: kind
        };
    }

    if (sku === "document") {
        return {
            destination: "viewer",
            action: "open",
            filename,
            contentType: kind
        };
    }

    if (sku === "explorer") {
        const dir = looksLikeDirectoryPath(path) && !file;
        const hasFile = Boolean(file) || Number(payload.fileCount || 0) > 0;
        return {
            destination: "explorer",
            action: dir || (path && !hasFile) ? "open" : hasFile ? "ask" : "open",
            filename,
            source: path || payload.hint?.source,
            contentType: kind
        };
    }

    if (sku === "launcher") {
        const hinted = payload.hint?.action;
        const wallpaper =
            hinted === "wallpaper" ||
            (hinted !== "shortcut" && looksLikeWallpaperFile(file || null));
        return {
            destination: "home",
            action: wallpaper ? "wallpaper" : "shortcut",
            filename,
            contentType: wallpaper ? "image" : undefined
        };
    }

    return undefined;
};

export const dataUrlToFile = async (
    raw: string,
    name = "shared.bin",
    mime = "application/octet-stream"
): Promise<File | null> => {
    const src = String(raw || "").trim();
    if (!src) return null;
    try {
        const blob = src.startsWith("data:")
            ? await (await fetch(src)).blob()
            : new Blob(
                  [Uint8Array.from(atob(src.replace(/^data:[^,]*,/, "")), (c) => c.charCodeAt(0))],
                  { type: mime }
              );
        return new File([blob], name, { type: blob.type || mime });
    } catch {
        return null;
    }
};

/** Paint wallpaper or pin a Speed Dial tile. Used by shell share-target and launch-queue. */
export const applyLauncherIngress = async (payload: {
    files?: File[];
    title?: string;
    text?: string;
    url?: string;
    action?: SkuIngressAction;
}): Promise<"wallpaper" | "shortcut" | "none"> => {
    const files = Array.isArray(payload.files) ? payload.files.filter((f): f is File => f instanceof File) : [];
    const image = files.find((f) => looksLikeWallpaperFile(f));
    if ((payload.action === "wallpaper" || !payload.action) && image && (await isWallpaperCompatible(image))) {
        const { setAppWallpaperFromBlob, getWallpaperStoragePointer, WALLPAPER_IDB_MARKER } = await import("@fest-lib/image");
        const { wallpaperState, persistWallpaper } = await import("fl-ui/speed-dial/launcher-state");
        await setAppWallpaperFromBlob(image);
        wallpaperState.src = getWallpaperStoragePointer() || WALLPAPER_IDB_MARKER;
        persistWallpaper();
        return "wallpaper";
    }

    const { pinSpeedDialLinkFromIntent, parseSpeedDialItemFromURL, parseSpeedDialItemFromSmartText, addSpeedDialItem, persistSpeedDialItems, persistSpeedDialMeta, findNextFreeSpeedDialCell } =
        await import("fl-ui/speed-dial/launcher-state");
    const cell = findNextFreeSpeedDialCell();
    const url = String(payload.url || "").trim();
    const text = String(payload.text || "").trim();
    const title = String(payload.title || files[0]?.name || "").trim();

    if (url) {
        const pinned = pinSpeedDialLinkFromIntent({ url, href: url, label: title || undefined, text, source: "share-target" }, cell);
        if (pinned) {
            persistSpeedDialItems();
            persistSpeedDialMeta();
            return "shortcut";
        }
    }
    const fromUrl = url ? parseSpeedDialItemFromURL(url, cell) : null;
    const fromText = !fromUrl && text ? parseSpeedDialItemFromSmartText(text, cell) || parseSpeedDialItemFromURL(text, cell) : null;
    const item = fromUrl || fromText;
    if (item) {
        addSpeedDialItem(item);
        persistSpeedDialItems();
        persistSpeedDialMeta();
        return "shortcut";
    }
    if (files[0]) {
        const pinned = pinSpeedDialLinkFromIntent(
            {
                label: files[0].name,
                text: files[0].name,
                mimeType: files[0].type,
                source: "share-target",
                action: "open-view"
            },
            cell
        );
        if (pinned) {
            persistSpeedDialItems();
            persistSpeedDialMeta();
            return "shortcut";
        }
    }
    return "none";
};

/*
 * Filename: sku-ingress.ts
 * FullPath: modules/projects/subsystem/src/routing/channel/sku-ingress.ts
 * FIND:sku
 * TAG:sku,share-target,open-policy
 * Change date and time: 08.30.00_30.08.2026
 * Reason for changes: Explorer directory ingress stays in Explorer (Transfer Open in Folder).
 */

import { inferCwspSkuFromLocation, type CwspSku } from "../../other/config/ecosystem-skus";
import {
    classifyOpenKindFromPayload,
    inferIngressChannels,
    peekOpenPolicy,
    resolveOpenPolicy,
    sinkToAction,
    sinkToDestination,
    surfaceForSku,
    type OpenPolicy,
    type OpenPolicyDestination,
    type OpenSink
} from "../../other/config/open-policy";
import type { AppSettings } from "../../other/config/SettingsTypes";
import { peekProcessIngressSettings, resolveProcessIngressKind } from "../../other/config/process-ingress";

export type SkuIngressAction = "open" | "attach" | "process" | "ask" | "shortcut" | "wallpaper";

/**
 * Same-tab File objects die when unified messaging queues through IDB/JSON.
 * Hold them in memory so Work Center can still attach the real blobs.
 */
const heldIngressFiles: File[] = [];

export const holdIngressFiles = (files?: File[] | null): void => {
    heldIngressFiles.length = 0;
    if (!Array.isArray(files)) return;
    for (const file of files) {
        if (file instanceof File) heldIngressFiles.push(file);
    }
};

export const takeHeldIngressFiles = (): File[] => heldIngressFiles.splice(0, heldIngressFiles.length);

export type SkuIngressHint = {
    destination: "viewer" | "workcenter" | "explorer" | "home" | "network";
    action: SkuIngressAction;
    filename?: string;
    source?: string;
    contentType?: string;
    /** Concrete open-policy sink — `document` vs `viewer`, `system` vs in-app. */
    sink?: OpenSink;
    instructionId?: string;
    copyToClipboard?: boolean;
};

type IngressProbe = {
    files?: File[];
    text?: string;
    url?: string;
    title?: string;
    fileCount?: number;
    source?: string;
    route?: string;
    hint?: { filename?: string; source?: string; destination?: string; action?: string };
};

const loadLauncherState = () => import("fl-ui/speed-dial/launcher-state");

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
const isNativeCapacitor = (): boolean => {
    try {
        const g = globalThis as { Capacitor?: { isNativePlatform?: () => boolean } };
        return Boolean(g.Capacitor?.isNativePlatform?.());
    } catch {
        return false;
    }
};

const skuDefaultDestination = (sku: CwspSku | ""): OpenPolicyDestination | undefined => {
    if (sku === "process") return "workcenter";
    if (sku === "document") return "viewer";
    if (sku === "explorer") return "explorer";
    if (sku === "launcher") return "home";
    return undefined;
};

export const skuIngressHint = (
    payload: IngressProbe,
    opts?: { sku?: CwspSku | ""; autoProcessShared?: boolean; openPolicy?: OpenPolicy; settings?: AppSettings | null }
): SkuIngressHint | undefined => {
    const sku = opts?.sku || inferCwspSkuFromLocation();
    const settings = opts?.settings || peekProcessIngressSettings();
    const file = firstFile(payload);
    const path = pathProbe(payload);
    const filename = payload.hint?.filename || file?.name || "";
    const kind = classifyOpenKindFromPayload(payload);
    const sourceToken = String(payload.source || payload.route || payload.hint?.source || "").toLowerCase();
    const ingressSource =
        sourceToken.includes("launch")
            ? "launch-queue"
            : sourceToken.includes("share")
              ? "share-target"
              : sourceToken.includes("snip")
                ? "snip"
                : sourceToken.includes("capacitor")
                  ? "capacitor"
                  : "";
    const surface = surfaceForSku(sku);
    const channels = inferIngressChannels(ingressSource || undefined, isNativeCapacitor());
    const sink = resolveOpenPolicy(opts?.openPolicy || peekOpenPolicy(), surface, kind, channels);
    const skuDest = skuDefaultDestination(sku);

    /* User-set sink wins over SKU lock. `ask` keeps the receiving SKU. */
    if (surface && sink !== "ask") {
        /* WHY: Transfer "Open in Folder" is a directory path — never hand off to Document. */
        if (sku === "explorer" && looksLikeDirectoryPath(path) && !file) {
            return {
                destination: "explorer",
                action: "open",
                filename,
                source: path || payload.hint?.source,
                contentType: kind
            };
        }
        const destination = sinkToDestination(sink, skuDest || "workcenter");
        if (destination === "workcenter") {
            const row = resolveProcessIngressKind(settings, kind);
            const hinted = payload.hint?.action;
            const action: SkuIngressAction =
                hinted === "attach" || hinted === "process"
                    ? hinted
                    : opts?.autoProcessShared === false
                      ? "attach"
                      : row.mode;
            return {
                destination,
                action,
                filename,
                source: path || payload.hint?.source,
                contentType: kind,
                sink,
                instructionId: row.instructionId,
                copyToClipboard: row.copyToClipboard
            };
        }
        return {
            destination,
            action: sinkToAction(sink, sku === "process" ? "process" : "open"),
            filename,
            source: path || payload.hint?.source,
            contentType: kind,
            sink
        };
    }

    if (!sku || sku === "crx") return undefined;
    if (sku === "transfer") {
        return {
            destination: "network",
            action: "open",
            filename,
            contentType: kind,
            sink: "transfer"
        };
    }

    if (sku === "process") {
        const row = resolveProcessIngressKind(settings, kind);
        const hinted = payload.hint?.action;
        const action: SkuIngressAction =
            hinted === "attach" || hinted === "process"
                ? hinted
                : opts?.autoProcessShared === false
                  ? "attach"
                  : row.mode;
        return {
            destination: "workcenter",
            action,
            filename,
            contentType: kind,
            instructionId: row.instructionId,
            copyToClipboard: row.copyToClipboard
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
        if (hasFile && !dir) {
            return {
                destination: "viewer",
                action: "open",
                filename,
                source: path || payload.hint?.source,
                contentType: kind,
                sink: "document"
            };
        }
        return {
            destination: "explorer",
            action: "open",
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

/**
 * Wallpaper sink: keep home only when the photo passes size/aspect.
 * WHY: icons and strips must not become wallpaper — send those to the viewer.
 */
export const refineLauncherImageIngress = async (
    hint: SkuIngressHint | undefined,
    files?: File[]
): Promise<SkuIngressHint | undefined> => {
    if (!hint || hint.action !== "wallpaper") return hint;
    if (!files?.length) return hint;
    const image = files.find((f) => looksLikeWallpaperFile(f));
    if (image && (await isWallpaperCompatible(image))) return hint;
    return {
        ...hint,
        destination: "viewer",
        action: "open",
        contentType: "image",
        sink: "viewer"
    };
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
        const { wallpaperState, persistWallpaper } = await loadLauncherState();
        await setAppWallpaperFromBlob(image);
        wallpaperState.src = getWallpaperStoragePointer() || WALLPAPER_IDB_MARKER;
        persistWallpaper();
        return "wallpaper";
    }
    /* WHY: wallpaper sink failed the fit check — do not pin a shortcut for a photo. */
    if (payload.action === "wallpaper") return "none";

    const { pinSpeedDialLinkFromIntent, parseSpeedDialItemFromURL, parseSpeedDialItemFromSmartText, addSpeedDialItem, persistSpeedDialItems, persistSpeedDialMeta, findNextFreeSpeedDialCell } =
        await loadLauncherState();
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

const SHELL_IMAGE_OPEN_EVENT = "cwsp:shell-image-open";

let shellImageOpenInstalled = false;

const openShellImageInViewer = async (file: File): Promise<void> => {
    const { dispatchViewTransfer } = await import("./ViewTransferRouting");
    await dispatchViewTransfer({
        source: "clipboard",
        route: "clipboard",
        files: [file],
        fileCount: 1,
        hint: { destination: "viewer", action: "open", filename: file.name, contentType: "image", sink: "viewer" }
    });
};

const applyShellWallpaper = async (file: File): Promise<boolean> => {
    if (!(await isWallpaperCompatible(file))) return false;
    const { setAppWallpaperFromBlob, getWallpaperStoragePointer, WALLPAPER_IDB_MARKER } = await import("@fest-lib/image");
    const { wallpaperState, persistWallpaper } = await loadLauncherState();
    await setAppWallpaperFromBlob(file);
    wallpaperState.src = getWallpaperStoragePointer() || WALLPAPER_IDB_MARKER;
    persistWallpaper();
    return true;
};

/**
 * Home drop/paste: SpeedDial fires `cwsp:shell-image-open`. Policy picks wallpaper vs viewer.
 */
export const installShellImageOpenListener = (): void => {
    if (shellImageOpenInstalled || typeof window === "undefined") return;
    shellImageOpenInstalled = true;
    window.addEventListener(SHELL_IMAGE_OPEN_EVENT, (raw) => {
        const ev = raw as CustomEvent<{ file?: File }>;
        const file = ev.detail?.file;
        if (!(file instanceof File)) return;
        ev.preventDefault();
        void (async () => {
            try {
                const { loadSettings } = await import("../../other/config/Settings");
                const { peekOpenPolicy, rememberOpenPolicyFromSettings, resolveOpenPolicy } = await import(
                    "../../other/config/open-policy"
                );
                const settings = await loadSettings().catch(() => null);
                rememberOpenPolicyFromSettings(settings);
                const sink = resolveOpenPolicy(
                    settings?.openPolicy ?? peekOpenPolicy(),
                    "shell",
                    "image",
                    "open"
                );
                if (sink === "viewer" || sink === "display") {
                    await openShellImageInViewer(file);
                    return;
                }
                if (sink === "document" || sink === "transfer" || sink === "system" || sink === "external") {
                    const { dispatchViewTransfer } = await import("./ViewTransferRouting");
                    await dispatchViewTransfer({
                        source: "clipboard",
                        route: "clipboard",
                        files: [file],
                        fileCount: 1,
                        hint: {
                            destination: sink === "transfer" ? "network" : "viewer",
                            action: "open",
                            filename: file.name,
                            contentType: "image",
                            sink
                        }
                    });
                    return;
                }
                if (sink === "workcenter") {
                    const { dispatchViewTransfer } = await import("./ViewTransferRouting");
                    await dispatchViewTransfer({
                        source: "clipboard",
                        route: "clipboard",
                        files: [file],
                        fileCount: 1,
                        hint: { destination: "workcenter", action: "attach", filename: file.name, contentType: "image" }
                    });
                    return;
                }
                if (sink === "wallpaper" || sink === "ask") {
                    if (await applyShellWallpaper(file)) return;
                    if (sink === "wallpaper") {
                        await openShellImageInViewer(file);
                    }
                    return;
                }
                if (!(await applyShellWallpaper(file))) await openShellImageInViewer(file);
            } catch (error) {
                console.warn("[sku-ingress] shell image open failed", error);
            }
        })();
    });
};

/*
 * Filename: open-policy.ts
 * FullPath: modules/projects/subsystem/src/other/config/open-policy.ts
 * FIND:open-policy
 * TAG:open-policy,share-target,sku
 * Change date and time: 01.15.00_30.08.2026
 * Reason for changes: Split Explorer Web channels from Capacitor nativeOpen so hosts cannot overwrite each other.
 */

/**
 * What to do with a file or payload, per surface / channel / kind.
 * INVARIANT: `ask` keeps the current SKU / content-type router.
 * Explorer: Web uses `channels`/`kinds`/`placement`. Capacitor uses `nativeOpen`/`nativeKinds` only.
 * Host slices live in `openPolicyByHost` (`settings-host.ts`).
 */

import { detectSettingsHost, SETTINGS_HOSTS, type SettingsHost } from "./settings-host";

export const OPEN_KINDS = ["markdown", "text", "document", "image", "url", "other"] as const;
export type OpenKind = (typeof OPEN_KINDS)[number];

export const OPEN_SINKS = [
    "ask",
    "display",
    "viewer",
    "document",
    "explorer",
    "workcenter",
    "transfer",
    "wallpaper",
    "external",
    "system"
] as const;
export type OpenSink = (typeof OPEN_SINKS)[number];

export const OPEN_CHANNELS = ["open", "dblclick", "share-target", "launch-queue", "snip", "capacitor"] as const;
export type OpenChannel = (typeof OPEN_CHANNELS)[number];

export const OPEN_SURFACES = ["viewer", "explorer", "shell", "crx", "process", "transfer"] as const;
export type OpenSurface = (typeof OPEN_SURFACES)[number];

/** How Explorer presents markdown/images in the browser (not Capacitor). */
export const OPEN_PLACEMENTS = ["inline", "native-window", "new-tab"] as const;
export type OpenPlacement = (typeof OPEN_PLACEMENTS)[number];

export type OpenPolicyKinds = Partial<Record<OpenKind, OpenSink>>;
export type OpenPolicyChannels = Partial<Record<OpenChannel, OpenSink>>;
export type OpenPolicySurface = {
    channels?: OpenPolicyChannels;
    kinds?: OpenPolicyKinds;
    /** Web/PWA/CRX window chrome. Capacitor ignores this. */
    placement?: OpenPlacement;
    /** Capacitor Explorer Open/click. Never written by Web settings. */
    nativeOpen?: OpenSink;
    /** Capacitor per-type override. `ask` = follow `nativeOpen`. */
    nativeKinds?: OpenPolicyKinds;
};
export type OpenPolicy = Partial<Record<OpenSurface, OpenPolicySurface>>;
export type OpenPolicyByHost = Partial<Record<SettingsHost, OpenPolicy>>;

const KIND_SET = new Set<string>(OPEN_KINDS);
const SINK_SET = new Set<string>(OPEN_SINKS);
const CHANNEL_SET = new Set<string>(OPEN_CHANNELS);
const SURFACE_SET = new Set<string>(OPEN_SURFACES);

const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|bmp|svg|avif|ico|jxl|tiff?|heic|heif)(?:$|[?#])/i;
const MARKDOWN_EXT = /\.(?:md|markdown|mdown|mkd|mkdn|mdtxt|mdtext)(?:$|[?#])/i;
const TEXT_EXT =
    /\.(?:txt|text|html|htm|css|scss|sass|less|json|csv|xml|yaml|yml|log|ini|env|toml|graphql|tsx?|jsx?|mts|cts|cjs|mjs|vue|svelte|rst)(?:$|[?#])/i;
const DOCUMENT_EXT = /\.(?:pdf|docx?|odt|rtf|pages|epub|pptx?|xlsx?|ods|odp)(?:$|[?#])/i;

export const DEFAULT_OPEN_POLICY: OpenPolicy = {
    viewer: {
        channels: {
            open: "display",
            "share-target": "display",
            "launch-queue": "display",
            capacitor: "display"
        },
        kinds: {
            markdown: "display",
            text: "display",
            document: "display",
            image: "display",
            url: "display",
            other: "display"
        }
    },
    explorer: {
        channels: {
            open: "viewer",
            dblclick: "viewer",
            "share-target": "viewer",
            "launch-queue": "viewer",
            capacitor: "document"
        },
        placement: "inline",
        kinds: {
            markdown: "ask",
            text: "ask",
            document: "ask",
            image: "ask",
            url: "ask",
            other: "ask"
        },
        nativeOpen: "document",
        nativeKinds: {
            markdown: "ask",
            text: "ask",
            document: "ask",
            image: "ask",
            url: "ask",
            other: "ask"
        }
    },
    shell: {
        channels: {
            open: "ask",
            "share-target": "ask",
            "launch-queue": "ask",
            capacitor: "ask"
        },
        kinds: {
            markdown: "ask",
            text: "ask",
            document: "ask",
            image: "wallpaper",
            url: "ask",
            other: "ask"
        }
    },
    crx: {
        channels: {
            open: "ask",
            snip: "workcenter",
            "share-target": "ask"
        },
        kinds: {
            markdown: "viewer",
            text: "viewer",
            document: "viewer",
            image: "workcenter",
            url: "workcenter",
            other: "workcenter"
        }
    },
    process: {
        channels: {
            open: "workcenter",
            "share-target": "workcenter",
            "launch-queue": "workcenter",
            capacitor: "workcenter"
        },
        kinds: {
            markdown: "workcenter",
            text: "workcenter",
            document: "workcenter",
            image: "workcenter",
            url: "workcenter",
            other: "workcenter"
        }
    },
    transfer: {
        channels: {
            open: "ask",
            "share-target": "ask",
            "launch-queue": "ask",
            capacitor: "ask"
        },
        kinds: {
            markdown: "ask",
            text: "ask",
            document: "ask",
            image: "ask",
            url: "ask",
            other: "ask"
        }
    }
};

let cachedPolicy: OpenPolicy = DEFAULT_OPEN_POLICY;

export const normalizeOpenSink = (raw: unknown, fallback: OpenSink = "ask"): OpenSink => {
    const v = String(raw || "")
        .trim()
        .toLowerCase();
    if (!v) return fallback;
    if (v === "markdown" || v === "in-shell" || v === "in-app") return "viewer";
    if (v === "document" || v === "cwsp-document" || v === "md") return "document";
    if (v === "process" || v === "cwsp-process") return "workcenter";
    if (v === "transfer" || v === "cwsp" || v === "cwsp-transfer" || v === "network") return "transfer";
    if (v === "wallpaper" || v === "обои" || v === "backdrop" || v === "desktop") return "wallpaper";
    if (v === "android" || v === "chooser" || v === "open-with") return "system";
    if (v === "browser" || v === "new-tab" || v === "tab") return "external";
    return SINK_SET.has(v) ? (v as OpenSink) : fallback;
};

export const normalizeOpenPlacement = (
    raw: unknown,
    fallback: OpenPlacement = "inline"
): OpenPlacement => {
    const v = String(raw || "")
        .trim()
        .toLowerCase();
    if (!v) return fallback;
    if (v === "in-shell" || v === "env" || v === "shell" || v === "iframe") return "inline";
    if (v === "native" || v === "popup" || v === "app-window" || v === "detached" || v === "separate") {
        return "native-window";
    }
    if (v === "tab" || v === "browser" || v === "as-is" || v === "browser-tab") return "new-tab";
    return (OPEN_PLACEMENTS as readonly string[]).includes(v) ? (v as OpenPlacement) : fallback;
};

export const normalizeOpenKind = (raw: unknown): OpenKind | "" => {
    const v = String(raw || "")
        .trim()
        .toLowerCase();
    return KIND_SET.has(v) ? (v as OpenKind) : "";
};

export const normalizeOpenChannel = (raw: unknown): OpenChannel | "" => {
    const v = String(raw || "")
        .trim()
        .toLowerCase();
    if (v === "dbl-click" || v === "double-click") return "dblclick";
    if (v === "share" || v === "sharetarget") return "share-target";
    if (v === "launch" || v === "launchqueue") return "launch-queue";
    return CHANNEL_SET.has(v) ? (v as OpenChannel) : "";
};

export const normalizeOpenSurface = (raw: unknown): OpenSurface | "" => {
    const v = String(raw || "")
        .trim()
        .toLowerCase();
    if (v === "document" || v === "markdown") return "viewer";
    if (v === "launcher" || v === "environment" || v === "home") return "shell";
    return SURFACE_SET.has(v) ? (v as OpenSurface) : "";
};

const normalizeKinds = (raw: unknown): OpenPolicyKinds => {
    const out: OpenPolicyKinds = {};
    if (!raw || typeof raw !== "object") return out;
    for (const key of OPEN_KINDS) {
        const sink = (raw as Record<string, unknown>)[key];
        if (sink == null || sink === "") continue;
        out[key] = normalizeOpenSink(sink);
    }
    return out;
};

const normalizeChannels = (raw: unknown): OpenPolicyChannels => {
    const out: OpenPolicyChannels = {};
    if (!raw || typeof raw !== "object") return out;
    for (const key of OPEN_CHANNELS) {
        const sink = (raw as Record<string, unknown>)[key];
        if (sink == null || sink === "") continue;
        out[key] = normalizeOpenSink(sink);
    }
    return out;
};

export const mergeOpenPolicy = (...parts: Array<OpenPolicy | null | undefined>): OpenPolicy => {
    const out: OpenPolicy = {};
    for (const surface of OPEN_SURFACES) {
        const base = DEFAULT_OPEN_POLICY[surface] || {};
        let channels: OpenPolicyChannels = { ...(base.channels || {}) };
        let kinds: OpenPolicyKinds = { ...(base.kinds || {}) };
        let placement = normalizeOpenPlacement(base.placement, "inline");
        let nativeOpen = normalizeOpenSink(base.nativeOpen, surface === "explorer" ? "document" : "ask");
        let nativeKinds: OpenPolicyKinds = { ...(base.nativeKinds || {}) };
        let nativeOpenSaved = false;
        for (const part of parts) {
            const src = part?.[surface];
            if (!src) continue;
            channels = { ...channels, ...normalizeChannels(src.channels) };
            kinds = { ...kinds, ...normalizeKinds(src.kinds) };
            if (src.placement != null && src.placement !== "") {
                placement = normalizeOpenPlacement(src.placement, placement);
            }
            if (src.nativeOpen != null && src.nativeOpen !== "") {
                nativeOpenSaved = true;
                nativeOpen = normalizeOpenSink(src.nativeOpen, nativeOpen);
            }
            if (src.nativeKinds) nativeKinds = { ...nativeKinds, ...normalizeKinds(src.nativeKinds) };
        }
        if (!nativeOpenSaved && surface === "explorer") {
            const legacy = channels.open;
            if (legacy === "system" || legacy === "transfer" || legacy === "workcenter") {
                nativeOpen = legacy;
            }
        }
        out[surface] =
            surface === "explorer"
                ? { channels, kinds, placement, nativeOpen, nativeKinds }
                : { channels, kinds, placement };
    }
    return out;
};

export const normalizeOpenPolicy = (raw: unknown): OpenPolicy =>
    mergeOpenPolicy(raw && typeof raw === "object" ? (raw as OpenPolicy) : undefined);

export const mergeOpenPolicyByHost = (
    ...parts: Array<OpenPolicyByHost | null | undefined>
): OpenPolicyByHost => {
    const out: OpenPolicyByHost = {};
    for (const host of SETTINGS_HOSTS) {
        const slices = parts.map((part) => part?.[host]).filter((p): p is OpenPolicy => Boolean(p));
        if (slices.length) out[host] = mergeOpenPolicy(...slices);
    }
    return out;
};

/** Host slice wins over a leftover flat `openPolicy` so Capacitor cannot clobber Web. */
export const resolveHostOpenPolicy = (settings?: {
    openPolicy?: OpenPolicy;
    openPolicyByHost?: OpenPolicyByHost;
} | null): OpenPolicy => {
    const host = detectSettingsHost();
    return mergeOpenPolicy(settings?.openPolicy, settings?.openPolicyByHost?.[host]);
};

export const stampHostOpenPolicy = (settings: {
    openPolicy?: OpenPolicy;
    openPolicyByHost?: OpenPolicyByHost;
}): OpenPolicy => {
    const host = detectSettingsHost();
    const next = mergeOpenPolicy(settings.openPolicy);
    settings.openPolicy = next;
    settings.openPolicyByHost = { ...(settings.openPolicyByHost || {}), [host]: next };
    return next;
};

export const rememberOpenPolicyFromSettings = (settings: {
    openPolicy?: OpenPolicy;
    openPolicyByHost?: OpenPolicyByHost;
} | null | undefined): OpenPolicy => {
    cachedPolicy = resolveHostOpenPolicy(settings);
    return cachedPolicy;
};

export const peekOpenPolicy = (): OpenPolicy => cachedPolicy;

export const surfaceForSku = (sku: string | undefined | null): OpenSurface | "" => {
    const v = String(sku || "")
        .trim()
        .toLowerCase();
    if (v === "document") return "viewer";
    if (v === "explorer") return "explorer";
    if (v === "launcher") return "shell";
    if (v === "process") return "process";
    if (v === "transfer") return "transfer";
    if (v === "crx") return "crx";
    return "";
};

const basenameOf = (raw: string): string => {
    const t = String(raw || "")
        .trim()
        .replace(/\\/g, "/");
    const noQuery = t.split(/[?#]/)[0] || t;
    const cut = noQuery.lastIndexOf("/");
    return (cut >= 0 ? noQuery.slice(cut + 1) : noQuery).trim();
};

export const classifyOpenKindFromName = (raw: string, mime = ""): OpenKind => {
    const name = basenameOf(raw);
    const type = String(mime || "").toLowerCase();
    if (type.startsWith("image/") || IMAGE_EXT.test(name)) return "image";
    if (type === "text/markdown" || type.includes("markdown") || MARKDOWN_EXT.test(name)) return "markdown";
    if (
        type === "application/pdf" ||
        type.includes("officedocument") ||
        type.includes("msword") ||
        type.includes("opendocument") ||
        DOCUMENT_EXT.test(name)
    ) {
        return "document";
    }
    if (
        type.startsWith("text/") ||
        type === "application/json" ||
        type === "application/xml" ||
        type === "application/javascript" ||
        type === "application/typescript" ||
        TEXT_EXT.test(name)
    ) {
        return "text";
    }
    return "other";
};

export const classifyOpenKind = (
    file: { name?: string; type?: string } | string | null | undefined
): OpenKind => {
    if (!file) return "other";
    if (typeof file === "string") return classifyOpenKindFromName(file);
    return classifyOpenKindFromName(String(file.name || ""), String(file.type || ""));
};

/** Image or PDF — viewer can paint these without treating bytes as markdown. */
export const looksLikePreviewableBinary = (file: { name?: string; type?: string } | null | undefined): boolean => {
    if (!file) return false;
    const kind = classifyOpenKind(file);
    if (kind === "image") return true;
    const name = String(file.name || "");
    const type = String(file.type || "").toLowerCase();
    return type === "application/pdf" || /\.pdf(?:$|[?#])/i.test(name);
};

export const classifyOpenKindFromPayload = (payload: {
    files?: Array<{ name?: string; type?: string }>;
    text?: string;
    url?: string;
    title?: string;
    fileCount?: number;
    hint?: { filename?: string; contentType?: string };
}): OpenKind => {
    const files = Array.isArray(payload.files) ? payload.files : [];
    if (files[0]) return classifyOpenKind(files[0]);
    const hinted = String(payload.hint?.contentType || "").toLowerCase();
    if (hinted === "markdown" || hinted === "text" || hinted === "image" || hinted === "url") {
        return hinted as OpenKind;
    }
    const name = String(payload.hint?.filename || payload.title || "").trim();
    if (name && (!payload.url || Number(payload.fileCount || 0) > 0)) {
        const fromName = classifyOpenKindFromName(name);
        if (fromName !== "other") return fromName;
    }
    const url = String(payload.url || "").trim();
    if (url) {
        const fromUrl = classifyOpenKindFromName(url);
        return fromUrl === "other" ? "url" : fromUrl;
    }
    if (String(payload.text || "").trim()) return "text";
    return "other";
};

const firstNonAsk = (...sinks: Array<OpenSink | undefined>): OpenSink | "" => {
    for (const sink of sinks) {
        if (sink && sink !== "ask") return sink;
    }
    return "";
};

/**
 * Explorer: channel (Open / click) wins, kind is an override only when channel is `ask`.
 * Other surfaces: kind override → first non-`ask` channel.
 */
export const resolveOpenPolicy = (
    policy: OpenPolicy | null | undefined,
    surface: OpenSurface | "",
    kind: OpenKind | "",
    channels: OpenChannel | OpenChannel[] = "open"
): OpenSink => {
    const surf = normalizeOpenSurface(surface);
    if (!surf) return "ask";
    const merged = mergeOpenPolicy(policy);
    const block = merged[surf] || {};
    const kinds = block.kinds || {};
    const chans = block.channels || {};
    const kindSink = kind && kinds[kind] ? kinds[kind] : undefined;
    const list = Array.isArray(channels) ? channels : [channels];
    const channelSinks = list
        .map((ch) => normalizeOpenChannel(ch))
        .filter((ch): ch is OpenChannel => Boolean(ch))
        .map((ch) => chans[ch]);
    if (surf === "explorer") {
        return firstNonAsk(...channelSinks, kindSink) || kindSink || channelSinks[0] || "ask";
    }
    return firstNonAsk(kindSink, ...channelSinks) || kindSink || channelSinks[0] || "ask";
};

/**
 * Capacitor Explorer has no inline viewer.
 * `document` → CWSP-document. `system` / `ask` / `external` → Android Open-with.
 * `viewer` / `display` only map to Document so a leftover web default still opens the APK.
 */
export const adaptExplorerSinkForNative = (sink: OpenSink): OpenSink => {
    if (sink === "viewer" || sink === "display") return "document";
    if (sink === "ask" || sink === "external") return "system";
    return sink;
};

const NATIVE_EXPLORER_SINKS = new Set<OpenSink>(["document", "system", "transfer", "workcenter"]);

/**
 * INVARIANT: Web reads `channels`/`kinds` only. Capacitor reads `nativeOpen`/`nativeKinds` only.
 * A leftover `channels.open` of document/system is honored on native until Settings saves `nativeOpen`.
 */
export const resolveExplorerOpenSink = (
    policy: OpenPolicy | null | undefined,
    kind: OpenKind | "",
    native: boolean,
    how: "open" | "dblclick" = "open"
): OpenSink => {
    const block = mergeOpenPolicy(policy).explorer || {};
    if (native) {
        const kindSink = kind && block.nativeKinds?.[kind] ? block.nativeKinds[kind] : undefined;
        const legacy = block.channels?.open;
        const open = normalizeOpenSink(
            block.nativeOpen ||
                (legacy && NATIVE_EXPLORER_SINKS.has(legacy) ? legacy : "") ||
                block.channels?.capacitor,
            "document"
        );
        return adaptExplorerSinkForNative(firstNonAsk(kindSink, open) || open);
    }
    const ch = how === "dblclick" ? block.channels?.dblclick : block.channels?.open;
    const kindSink = kind && block.kinds?.[kind] ? block.kinds[kind] : undefined;
    return firstNonAsk(ch, kindSink) || kindSink || ch || "viewer";
};

export type OpenPolicyDestination = "viewer" | "workcenter" | "explorer" | "home" | "network";

export const sinkToDestination = (
    sink: OpenSink,
    fallback: OpenPolicyDestination
): OpenPolicyDestination => {
    if (sink === "viewer" || sink === "document") return "viewer";
    if (sink === "explorer") return "explorer";
    if (sink === "workcenter") return "workcenter";
    if (sink === "transfer") return "network";
    if (sink === "wallpaper") return "home";
    if (sink === "display") return fallback;
    return fallback;
};

export const sinkToAction = (sink: OpenSink, fallback: "open" | "attach" | "process" | "ask" = "open") => {
    if (sink === "workcenter") return "process";
    if (sink === "viewer" || sink === "display" || sink === "document" || sink === "transfer") return "open";
    if (sink === "explorer") return "open";
    if (sink === "wallpaper") return "wallpaper";
    return fallback;
};

/** Sibling SKU for a sink. `viewer` / `display` stay in this app. */
export const skuForOpenSink = (
    sink: OpenSink
): "document" | "explorer" | "process" | "transfer" | "" => {
    if (sink === "document") return "document";
    if (sink === "workcenter") return "process";
    if (sink === "transfer") return "transfer";
    if (sink === "explorer") return "explorer";
    return "";
};

/** Per-tile Speed Dial target for a sink. `ask` leaves the tile unset (global default). */
export const sinkToOpenLinkTarget = (
    sink: OpenSink
): "viewer" | "document" | "explorer" | "workcenter" | "transfer" | "external-app" | "" => {
    if (sink === "viewer" || sink === "display") return "viewer";
    if (sink === "document") return "document";
    if (sink === "explorer") return "explorer";
    if (sink === "workcenter") return "workcenter";
    if (sink === "transfer") return "transfer";
    if (sink === "system" || sink === "external") return "external-app";
    return "";
};

export const resolveOpenPlacement = (
    policy: OpenPolicy | null | undefined,
    surface: OpenSurface | "" = "explorer"
): OpenPlacement => {
    const surf = normalizeOpenSurface(surface) || "explorer";
    return normalizeOpenPlacement(mergeOpenPolicy(policy)[surf]?.placement, "inline");
};

export const viewIdForOpenSink = (sink: OpenSink): string => {
    if (sink === "document" || sink === "viewer") return "viewer";
    if (sink === "workcenter") return "workcenter";
    if (sink === "transfer") return "network";
    if (sink === "explorer") return "explorer";
    return "";
};

export const inferIngressChannels = (
    source: string | undefined,
    native: boolean
): OpenChannel[] => {
    const src = String(source || "").toLowerCase();
    const out: OpenChannel[] = [];
    if (native && (src === "launch-queue" || src === "share-target" || src === "capacitor")) {
        out.push("capacitor");
    }
    if (src === "share-target") out.push("share-target");
    else if (src === "launch-queue") out.push("launch-queue");
    else if (src === "snip") out.push("snip");
    else out.push("open");
    return out;
};

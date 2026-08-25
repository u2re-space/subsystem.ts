/*
 * Filename: ecosystem-skus.ts
 * FullPath: modules/projects/subsystem/src/other/config/ecosystem-skus.ts
 * FIND:sku
 * TAG:sku,settings-profile
 * Change date and time: 09.20.00_25.08.2026
 * Reason for changes: Specialized hosts hide sibling chrome; attach/open hands off to SKU URLs. Only u2re.space keeps /viewer /explorer /process in-process.
 */

/**
 * Fleet SKUs that may live in separate APKs (Android) or share a host (CRX).
 * INVARIANT: do not conflate Endpoint URL, direct URL, AirPad URL, and destination client id.
 * CRX keeps process (workcenter / snip / formulas) in-process — no extra extension.
 */
export type CwspSku = "launcher" | "transfer" | "explorer" | "document" | "process" | "crx";

export type EcosystemSkuRecord = {
    sku: CwspSku;
    /** Android applicationId. CRX has none. */
    androidPackage: string | null;
    scheme: string;
    phosphorIcon: string;
    defaultView: string;
    shell: "environment" | "minimal";
    /** Gateway APK manifest filename under /releases/android/. */
    apkManifest: string;
    apkName: string;
};

export const ECOSYSTEM_SKUS: Record<CwspSku, EcosystemSkuRecord> = {
    launcher: {
        sku: "launcher",
        androidPackage: "space.u2re.cw",
        scheme: "space.u2re.cw",
        phosphorIcon: "cross",
        defaultView: "home",
        shell: "environment",
        apkManifest: "latest-launcher.json",
        apkName: "cwsp-launcher.apk"
    },
    transfer: {
        sku: "transfer",
        androidPackage: "space.u2re.cwsp",
        scheme: "space.u2re.cwsp",
        phosphorIcon: "drone",
        defaultView: "network",
        shell: "minimal",
        apkManifest: "latest.json",
        apkName: "cwsp.apk"
    },
    explorer: {
        sku: "explorer",
        androidPackage: "space.u2re.explorer",
        scheme: "space.u2re.explorer",
        phosphorIcon: "folder",
        defaultView: "explorer",
        shell: "minimal",
        apkManifest: "latest-explorer.json",
        apkName: "cwsp-explorer.apk"
    },
    document: {
        sku: "document",
        androidPackage: "space.u2re.document",
        scheme: "space.u2re.document",
        phosphorIcon: "books",
        defaultView: "viewer",
        shell: "minimal",
        apkManifest: "latest-document.json",
        apkName: "cwsp-document.apk"
    },
    process: {
        sku: "process",
        androidPackage: "space.u2re.process",
        scheme: "space.u2re.process",
        phosphorIcon: "magic-wand",
        defaultView: "workcenter",
        shell: "minimal",
        apkManifest: "latest-process.json",
        apkName: "cwsp-process.apk"
    },
    crx: {
        sku: "crx",
        androidPackage: null,
        scheme: "chrome-extension",
        phosphorIcon: "cross",
        defaultView: "home",
        shell: "environment",
        apkManifest: "",
        apkName: ""
    }
};

const SKU_SET = new Set<string>(Object.keys(ECOSYSTEM_SKUS));

/** Views that leave the launcher APK and open a sibling SKU. */
export const VIEW_TO_SIBLING_SKU: Record<string, Exclude<CwspSku, "launcher" | "crx">> = {
    explorer: "explorer",
    viewer: "document",
    editor: "document",
    markdown: "document",
    print: "document",
    workcenter: "process",
    network: "transfer"
};

export const isCwspSku = (value: unknown): value is CwspSku =>
    typeof value === "string" && SKU_SET.has(value);

export const readCwspSku = (): CwspSku | "" => {
    try {
        const raw = String(document.documentElement?.dataset?.cwspSku || "").trim().toLowerCase();
        return isCwspSku(raw) ? raw : "";
    } catch {
        return "";
    }
};

/** Stamp `data-cwsp-sku` so Settings / openView / APK update resolve the same host. */
export const applyCwspSku = (sku: CwspSku): void => {
    try {
        document.documentElement.dataset.cwspSku = sku;
        const rec = ECOSYSTEM_SKUS[sku];
        if (rec.defaultView && !document.documentElement.dataset.cwspDefaultView) {
            document.documentElement.dataset.cwspDefaultView = rec.defaultView;
        }
    } catch {
        /* non-DOM tests */
    }
};

export const siblingSkuForView = (view: string): Exclude<CwspSku, "launcher" | "crx"> | null => {
    const key = String(view || "").trim().toLowerCase();
    return VIEW_TO_SIBLING_SKU[key] || null;
};

export const HUB_PUBLIC_HOSTS = ["u2re.space", "www.u2re.space"] as const;

export const SKU_PUBLIC_HOSTS: Record<Exclude<CwspSku, "launcher" | "crx">, readonly string[]> = {
    document: ["md.u2re.space", "www.md.u2re.space"],
    explorer: ["explorer.u2re.space", "www.explorer.u2re.space"],
    process: ["process.u2re.space", "workcenter.u2re.space"],
    transfer: ["cwsp.u2re.space", "www.cwsp.u2re.space", "transfer.u2re.space"]
};

/** Hub/LAN Fastify prefixes — never nest (`/viewer/explorer`). */
export const SKU_HUB_PATHS: Record<Exclude<CwspSku, "launcher" | "crx">, readonly string[]> = {
    document: ["markdown", "document", "viewer"],
    explorer: ["explorer"],
    process: ["workcenter", "process"],
    transfer: ["cwsp", "transfer"]
};

/** Specialized chrome. Empty list = hub/CRX keeps every view. */
export const SKU_LOCAL_NAV_VIEWS: Record<CwspSku, readonly string[]> = {
    launcher: [],
    crx: [],
    document: ["viewer", "editor", "print", "settings", "history"],
    explorer: ["explorer", "settings", "history"],
    process: ["workcenter", "settings", "history"],
    transfer: ["network", "settings", "history"]
};

const currentHostname = (): string => {
    try {
        return String(globalThis.location?.hostname || "").toLowerCase();
    } catch {
        return "";
    }
};

const firstPathSegment = (): string => {
    try {
        const path = String(globalThis.location?.pathname || "/").split("?")[0] || "/";
        return path.split("/").filter(Boolean)[0]?.toLowerCase() || "";
    } catch {
        return "";
    }
};

const isLanOrLoopbackHost = (host: string): boolean =>
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host);

export const isHubPublicHost = (hostname?: string): boolean => {
    const host = String(hostname || currentHostname()).toLowerCase();
    return (HUB_PUBLIC_HOSTS as readonly string[]).includes(host);
};

/** Web `u2re.space` / LAN hub — not a Capacitor APK and not a dedicated SKU host. */
export const isWebHubSurface = (): boolean => {
    if (isCwspNativeHost()) return false;
    const host = currentHostname();
    return isHubPublicHost(host) || isLanOrLoopbackHost(host);
};

export const skuForHubPathSegment = (segment: string): Exclude<CwspSku, "launcher" | "crx"> | "" => {
    const seg = String(segment || "").trim().toLowerCase();
    if (!seg) return "";
    for (const sku of Object.keys(SKU_HUB_PATHS) as Array<Exclude<CwspSku, "launcher" | "crx">>) {
        if (SKU_HUB_PATHS[sku].includes(seg)) return sku;
    }
    return "";
};

/** Host + hub/LAN path mount → SKU. `u2re.space/` stays launcher (full chrome). */
export const inferCwspSkuFromLocation = (): CwspSku | "" => {
    const stamped = readCwspSku();
    if (stamped) return stamped;
    const host = currentHostname();
    for (const sku of Object.keys(SKU_PUBLIC_HOSTS) as Array<Exclude<CwspSku, "launcher" | "crx">>) {
        if (SKU_PUBLIC_HOSTS[sku].includes(host)) return sku;
    }
    const fromPath = skuForHubPathSegment(firstPathSegment());
    if (fromPath) return fromPath;
    if (isHubPublicHost(host) || isLanOrLoopbackHost(host)) return "launcher";
    return "";
};

export const ensureCwspSkuFromLocation = (): CwspSku | "" => {
    const sku = inferCwspSkuFromLocation();
    if (sku) applyCwspSku(sku);
    return sku;
};

const normalizeNavViewId = (view: string): string => {
    const key = String(view || "").trim().toLowerCase();
    if (key === "markdown" || key === "document" || key === "md") return "viewer";
    if (key === "process") return "workcenter";
    if (key === "files" || key === "fm") return "explorer";
    if (key === "transfer") return "network";
    return key;
};

/** False on a specialized host/mount for views that belong to another SKU. */
export const isViewLocalToSurface = (view: string, sku = inferCwspSkuFromLocation()): boolean => {
    const id = normalizeNavViewId(view);
    if (!id) return false;
    if (!sku || sku === "launcher" || sku === "crx") return true;
    const local = SKU_LOCAL_NAV_VIEWS[sku];
    if (!local.length) return true;
    return local.includes(id);
};

/** Canonical hub/LAN path the user types (`/viewer` not `/markdown`). */
export const SKU_PUBLIC_HUB_PATH: Record<Exclude<CwspSku, "launcher" | "crx">, string> = {
    document: "/viewer",
    explorer: "/explorer",
    process: "/process",
    transfer: "/cwsp"
};

/** Path or absolute URL for a sibling SKU. Hub keeps `/viewer` `/explorer` `/process`. */
export const publicHrefForSku = (sku: Exclude<CwspSku, "launcher" | "crx">): string => {
    const host = currentHostname();
    const hosts = SKU_PUBLIC_HOSTS[sku];
    const path = SKU_PUBLIC_HUB_PATH[sku];
    if (hosts.includes(host)) return "/";
    if (isHubPublicHost(host) || isLanOrLoopbackHost(host)) return path;
    return `https://${hosts[0]}/`;
};

export const publicHrefForView = (view: string): string | null => {
    const sku = siblingSkuForView(normalizeNavViewId(view));
    return sku ? publicHrefForSku(sku) : null;
};

export const isCwspNativeHost = (): boolean => {
    try {
        const g = globalThis as {
            Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
            __CWS_NATIVE__?: boolean;
        };
        const platform = g.Capacitor?.getPlatform?.();
        return Boolean(
            g.Capacitor?.isNativePlatform?.() ||
                platform === "android" ||
                platform === "ios" ||
                g.__CWS_NATIVE__ === true
        );
    } catch {
        return false;
    }
};

/**
 * Leave this PWA for a sibling SKU.
 * INVARIANT: web `u2re.space` (launcher) keeps `/viewer` `/explorer` `/process` in-process.
 * Native launcher still opens sibling APKs.
 */
export const shouldHandoffViewToSibling = (view: string): boolean => {
    const id = normalizeNavViewId(view);
    const sibling = siblingSkuForView(id);
    if (!sibling) return false;
    const sku = inferCwspSkuFromLocation();
    if (sku === "crx") return false;
    if ((!sku || sku === "launcher") && !isCwspNativeHost()) return false;
    if (sku === sibling) return false;
    if (sku && sku !== "launcher" && sku !== "crx" && isViewLocalToSurface(id, sku)) return false;
    return true;
};

export const CWSP_SKU_HANDOFF_KEY = "cwsp-sku-handoff";

export type CwspSkuHandoff = {
    dest?: string;
    content?: string;
    filename?: string;
    src?: string;
    ts?: number;
};

export const stashSkuHandoff = (payload: Omit<CwspSkuHandoff, "ts">): void => {
    try {
        globalThis.sessionStorage?.setItem?.(
            CWSP_SKU_HANDOFF_KEY,
            JSON.stringify({ ...payload, ts: Date.now() })
        );
    } catch {
        /* quota / non-DOM */
    }
};

export const takeSkuHandoff = (...accept: string[]): CwspSkuHandoff | null => {
    try {
        const raw = globalThis.sessionStorage?.getItem?.(CWSP_SKU_HANDOFF_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as CwspSkuHandoff;
        const dest = normalizeNavViewId(String(parsed.dest || ""));
        if (accept.length && dest) {
            const ok = accept.some((entry) => normalizeNavViewId(entry) === dest);
            if (!ok) return null;
        }
        globalThis.sessionStorage?.removeItem?.(CWSP_SKU_HANDOFF_KEY);
        return parsed;
    } catch {
        return null;
    }
};

try {
    ensureCwspSkuFromLocation();
} catch {
    /* non-DOM */
}

export const androidPackageForSku = (sku: CwspSku): string | null =>
    ECOSYSTEM_SKUS[sku]?.androidPackage ?? null;

export const apkManifestForSku = (sku: CwspSku): string =>
    ECOSYSTEM_SKUS[sku]?.apkManifest || "";

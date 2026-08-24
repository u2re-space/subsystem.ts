/*
 * Filename: ecosystem-skus.ts
 * FullPath: modules/projects/subsystem/src/other/config/ecosystem-skus.ts
 * FIND:sku
 * TAG:sku,settings-profile
 * Change date and time: 14.25.00_24.08.2026
 * Reason for changes: Process SKU owns WorkCenter + AI; document is print/read/edit only.
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

export const androidPackageForSku = (sku: CwspSku): string | null =>
    ECOSYSTEM_SKUS[sku]?.androidPackage ?? null;

export const apkManifestForSku = (sku: CwspSku): string =>
    ECOSYSTEM_SKUS[sku]?.apkManifest || "";

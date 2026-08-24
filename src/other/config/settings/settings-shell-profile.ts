/*
 * Filename: settings-shell-profile.ts
 * FullPath: modules/projects/subsystem/src/other/config/settings/settings-shell-profile.ts
 * FIND:settings-profile
 * TAG:sku,settings-profile
 * Change date and time: 22.20.00_24.08.2026
 * Reason for changes: Hub `/settings/{area}` aliases + SKU override.
 */

import { isEnabledView } from "../../../routing/core/views";
import { readCwspSku, type CwspSku } from "../ecosystem-skus";
import type { SettingsContributionContext } from "../SettingsContributions";

/** Which built-in settings host variant to render. */
export type SettingsShellProfile =
    | "full"
    | "cwsp-mobile"
    | "extension"
    | "markdown"
    | "document"
    | "process"
    | "environment"
    | "explorer";

const skuFromCtx = (ctx: SettingsContributionContext): CwspSku | "" => {
    if (ctx.sku) return ctx.sku;
    return readCwspSku();
};

/**
 * Resolve tabs from `data-cwsp-sku` first.
 * WHY: Capacitor without desktop views used to mean transfer (cwsp-mobile). After the
 * launcher drops explorer/viewer it would incorrectly inherit the CWSP tab.
 */
export const resolveSettingsShellProfile = (
    ctx: SettingsContributionContext
): SettingsShellProfile => {
    if (ctx.isExtension || ctx.surface === "crx") return "extension";
    const sku = skuFromCtx(ctx);
    if (sku === "launcher") return "environment";
    if (sku === "transfer") return "cwsp-mobile";
    if (sku === "explorer") return "explorer";
    if (sku === "document") return "document";
    if (sku === "process") return "process";
    if (sku === "crx") return "extension";
    // WHY: md.u2re.space settings are document/AI only — CWSP Control is cwsp.u2re.space.
    if (ctx.surface === "markdown") return "markdown";
    // WHY: CWSP-shell environment — Appearance/Workspace only; Control lives on transfer.
    if (ctx.surface === "environment") return "environment";
    if (ctx.surface === "capacitor" || ctx.surface === "native") {
        const desktopViews =
            isEnabledView("workcenter") ||
            isEnabledView("viewer") ||
            isEnabledView("explorer");
        if (!desktopViews) return "cwsp-mobile";
    }
    return "full";
};

const CWSP_MOBILE_HIDDEN_BUILTIN_TABS = [
    "appearance",
    "markdown",
    "ai",
    "mcp",
    "server",
    "instructions",
    "extension"
] as const;

/**
 * CRX options page: drop built-in Extension (NTP) — folded into contributed `crx`
 * tab — and Server (CWSP tab owns hub/endpoint).
 */
const EXTENSION_HIDDEN_BUILTIN_TABS = ["extension", "server"] as const;

/** VDS md.u2re.space PWA: no Server / Extension (Control/CRX own those). */
const MARKDOWN_HIDDEN_BUILTIN_TABS = ["server", "extension"] as const;

/** Capacitor document: print / read / edit only — AI lives on process. */
const DOCUMENT_HIDDEN_BUILTIN_TABS = ["server", "extension", "cwsp", "ai", "mcp", "instructions"] as const;

/** Process APK / WorkCenter: AI + MCP + instructions; no print Markdown / Control. */
const PROCESS_HIDDEN_BUILTIN_TABS = ["server", "extension", "cwsp", "markdown"] as const;

/**
 * Launcher / environment desktop: Appearance + Workspace + self-APK Updates.
 * INVARIANT: print/read/edit live on document; AI/WorkCenter on process; Control on transfer.
 * NOTE: `cwsp` is contributed (not built-in); same DOM selectors still remove the tab/panel.
 */
const ENVIRONMENT_HIDDEN_BUILTIN_TABS = [
    "server",
    "extension",
    "cwsp",
    "markdown",
    "ai",
    "mcp",
    "instructions"
] as const;

/** Explorer APK: no document/control tabs. Storage UI stays in the explorer view. */
const EXPLORER_HIDDEN_BUILTIN_TABS = [
    "markdown",
    "ai",
    "mcp",
    "server",
    "instructions",
    "extension",
    "cwsp"
] as const;

/** Remove host-variant built-in tabs that the profile replaces or folds elsewhere. */
export const pruneBuiltInSettingsTabs = (
    root: HTMLElement,
    profile: SettingsShellProfile
): void => {
    const hidden =
        profile === "cwsp-mobile"
            ? CWSP_MOBILE_HIDDEN_BUILTIN_TABS
            : profile === "extension"
              ? EXTENSION_HIDDEN_BUILTIN_TABS
              : profile === "markdown"
                ? MARKDOWN_HIDDEN_BUILTIN_TABS
                : profile === "document"
                  ? DOCUMENT_HIDDEN_BUILTIN_TABS
                  : profile === "process"
                    ? PROCESS_HIDDEN_BUILTIN_TABS
                : profile === "environment"
                  ? ENVIRONMENT_HIDDEN_BUILTIN_TABS
                  : profile === "explorer"
                    ? EXPLORER_HIDDEN_BUILTIN_TABS
                    : null;
    if (!hidden) return;
    for (const tab of hidden) {
        root.querySelector(`[data-tab-panel="${tab}"]`)?.remove();
        root.querySelector(`[data-action="switch-settings-tab"][data-tab="${tab}"]`)?.remove();
    }
};

export const defaultSettingsTabForProfile = (profile: SettingsShellProfile): string => {
    if (profile === "cwsp-mobile") return "cwsp";
    // WHY: contributed `crx` panel is the single Extension tab after prune.
    if (profile === "extension") return "crx";
    if (profile === "markdown" || profile === "document") return "markdown";
    if (profile === "process") return "ai";
    if (profile === "environment") return "appearance";
    if (profile === "explorer") return "appearance";
    return "ai";
};

export const hasBuiltInSettingsPanel = (root: HTMLElement, panelId: string): boolean =>
    Boolean(root.querySelector(`[data-tab-panel="${panelId}"]`));

/**
 * Hub (`u2re.space`) settings areas. Aliases collapse to one section.
 * `/settings/cwsp` ≡ `/settings/transfer`, `/settings/viewer` ≡ `/settings/markdown`,
 * `/settings/process` ≡ `/settings/workcenter`.
 */
export type HubSettingsSection = "hub" | "explorer" | "transfer" | "document" | "process";

const HUB_SETTINGS_ALIASES: Record<string, HubSettingsSection> = {
    "": "hub",
    hub: "hub",
    shell: "hub",
    explorer: "explorer",
    cwsp: "transfer",
    transfer: "transfer",
    viewer: "document",
    markdown: "document",
    document: "document",
    md: "document",
    process: "process",
    workcenter: "process"
};

/** Canonical path segment for a hub settings section (`hub` → no extra segment). */
export const hubSettingsSectionPath = (section: HubSettingsSection): string => {
    if (section === "hub") return "";
    if (section === "document") return "markdown";
    return section;
};

export const canonicalHubSettingsSection = (raw: string | undefined | null): HubSettingsSection => {
    const key = String(raw || "").trim().toLowerCase();
    return HUB_SETTINGS_ALIASES[key] || "hub";
};

const isCentralHubHost = (): boolean => {
    try {
        const host = String(globalThis.location?.hostname || "").toLowerCase();
        if (host === "u2re.space" || host === "www.u2re.space") return true;
        if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
        const surface = String(document.documentElement?.dataset?.cwspSurface || "").toLowerCase();
        return surface === "vds-main";
    } catch {
        return false;
    }
};

/**
 * Hub `/settings` and `/settings/{area}` only. `/explorer/settings` stays the explorer module.
 * WHY: sibling path mounts set a history base; those are not the central settings tree.
 */
export const resolveEffectiveHubSettingsSection = (): HubSettingsSection | null => {
    if (!isCentralHubHost()) return null;
    try {
        const base = String(document.documentElement?.dataset?.cwspRouterBase || "").replace(/\/+$/, "");
        if (base && base !== "/") return null;
        const path = String(globalThis.location?.pathname || "/").split("?")[0] || "/";
        const segs = path.split("/").filter(Boolean);
        if (segs[0]?.toLowerCase() !== "settings") return null;
        return canonicalHubSettingsSection(segs[1] || "");
    } catch {
        return null;
    }
};

export const skuForHubSettingsSection = (section: HubSettingsSection): CwspSku | "" => {
    if (section === "explorer") return "explorer";
    if (section === "transfer") return "transfer";
    if (section === "document") return "document";
    if (section === "process") return "process";
    return "launcher";
};

export const SIBLING_HUB_SETTINGS_SECTIONS = [
    "explorer",
    "document",
    "process",
    "transfer"
] as const satisfies readonly Exclude<HubSettingsSection, "hub">[];

export const ALL_HUB_SETTINGS_SECTIONS: HubSettingsSection[] = [
    "hub",
    ...SIBLING_HUB_SETTINGS_SECTIONS
];

export type SettingsAreaNavMode = "hub" | "launcher" | "none";

/**
 * Hub shows every area. Launcher Android shows Shell plus installed sibling APKs only.
 * Empty → hide the area nav (no extra tabs).
 */
export const visibleHubSettingsSections = (
    mode: SettingsAreaNavMode,
    installedSiblings?: readonly HubSettingsSection[] | null
): HubSettingsSection[] => {
    if (mode === "hub") return ALL_HUB_SETTINGS_SECTIONS.slice();
    if (mode === "launcher") {
        if (!installedSiblings) return [];
        const sibs = SIBLING_HUB_SETTINGS_SECTIONS.filter((s) => installedSiblings.includes(s));
        return sibs.length ? ["hub", ...sibs] : [];
    }
    return [];
};

export const rememberSettingsAreaSection = (section: HubSettingsSection): void => {
    try {
        document.documentElement.dataset.cwspSettingsSection = section;
    } catch {
        /* tests */
    }
};

export const readSettingsAreaSection = (): HubSettingsSection | "" => {
    try {
        const raw = String(document.documentElement?.dataset?.cwspSettingsSection || "").trim();
        return raw ? canonicalHubSettingsSection(raw) : "";
    } catch {
        return "";
    }
};

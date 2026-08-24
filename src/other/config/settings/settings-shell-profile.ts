/*
 * Filename: settings-shell-profile.ts
 * FullPath: modules/projects/subsystem/src/other/config/settings/settings-shell-profile.ts
 * FIND:settings-profile
 * TAG:sku,settings-profile
 * Change date and time: 14.25.00_24.08.2026
 * Reason for changes: Document settings are print/read/edit; AI/MCP live on process.
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

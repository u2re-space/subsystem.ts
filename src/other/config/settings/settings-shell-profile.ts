import { isEnabledView } from "../../../routing/core/views";
import type { SettingsContributionContext } from "../SettingsContributions";

/** Which built-in settings host variant to render. */
export type SettingsShellProfile = "full" | "cwsp-mobile" | "extension";

/**
 * CWSAndroid / Capacitor CWSP shells enable only `network` + `settings` — no workcenter,
 * viewer, explorer AI stack, or CRX extension panels.
 */
export const resolveSettingsShellProfile = (
    ctx: SettingsContributionContext
): SettingsShellProfile => {
    if (ctx.isExtension || ctx.surface === "crx") return "extension";
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
    return "ai";
};

export const hasBuiltInSettingsPanel = (root: HTMLElement, panelId: string): boolean =>
    Boolean(root.querySelector(`[data-tab-panel="${panelId}"]`));

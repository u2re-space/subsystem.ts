/*
 * Filename: settings-host.ts
 * FullPath: modules/projects/subsystem/src/other/config/settings-host.ts
 * FIND:settings-host
 * TAG:settings-host,open-policy
 * Change date and time: 01.35.00_30.08.2026
 * Reason for changes: Capacitor / CRX / PWA / Web settings are separate slices, not one shared openPolicy blob.
 */

import { isCwspNativeHost } from "./ecosystem-skus";

export const SETTINGS_HOSTS = ["capacitor", "crx", "pwa", "web"] as const;
export type SettingsHost = (typeof SETTINGS_HOSTS)[number];

const isCrxHost = (): boolean => {
    try {
        const proto = String(globalThis.location?.protocol || "").toLowerCase();
        if (proto === "chrome-extension:" || proto === "moz-extension:") return true;
        return Boolean((globalThis as { chrome?: { runtime?: { id?: string } } }).chrome?.runtime?.id);
    } catch {
        return false;
    }
};

const isPwaStandalone = (): boolean => {
    try {
        const surface = String(document.documentElement?.dataset?.cwspSurface || "").toLowerCase();
        if (surface.includes("pwa")) return true;
        const standalone =
            globalThis.matchMedia?.("(display-mode: standalone)").matches ||
            (globalThis.navigator as { standalone?: boolean }).standalone === true;
        return Boolean(standalone);
    } catch {
        return false;
    }
};

/**
 * INVARIANT: Capacitor wins over standalone (WebView is also standalone).
 * CRX wins over PWA. Web and PWA on the same origin keep different slices.
 */
export const detectSettingsHost = (): SettingsHost => {
    if (isCwspNativeHost()) return "capacitor";
    if (isCrxHost()) return "crx";
    if (isPwaStandalone()) return "pwa";
    return "web";
};

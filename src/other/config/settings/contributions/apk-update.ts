/*
 * Filename: apk-update.ts
 * FullPath: modules/projects/subsystem/src/other/config/settings/contributions/apk-update.ts
 * FIND:apk-update
 * TAG:sku,apk-update
 * Change date and time: 15.10.00_24.08.2026
 * Reason for changes: Launcher environment host also owns this self-APK Updates block.
 */

import {
    registerSettingsContribution,
    type SettingsContributionContext
} from "../../SettingsContributions";
import type { AppSettings } from "../../SettingsTypes";
import {
    apkManifestForSku,
    readCwspSku,
    type CwspSku
} from "../../ecosystem-skus";
import {
    settingsButton,
    settingsButtonRow,
    settingsHint,
    settingsPanel,
    settingsSelectField,
    type SettingsPanelChild
} from "../settings-contribution-ui";

const skuOf = (ctx: SettingsContributionContext): CwspSku | "" => ctx.sku || readCwspSku();

const apkUpdateFields = (ctx: SettingsContributionContext): SettingsPanelChild[] => {
    const sku = skuOf(ctx);
    const manifest = sku ? apkManifestForSku(sku) : "";
    const versionHint = document.createElement("p");
    versionHint.className = "field-hint";
    versionHint.setAttribute("data-apk-local-version", "1");
    versionHint.textContent = "Installed version: … (tap Check to refresh)";

    const hint =
        sku === "launcher"
            ? "This launcher APK reads latest-launcher.json. Transfer / explorer / document each update themselves."
            : sku === "transfer"
              ? "This hub APK reads latest.json (ecosystem token). Other SKUs are not installed from here."
              : manifest
                ? `This app reads ${manifest} for its own APK only.`
                : "Checks the gateway release that matches this installed package.";

    return [
        "App update (dev)",
        versionHint,
        settingsSelectField("Update source", "shell.apkUpdateSource", [
            ["wan", "WAN — https://45.147.121.152:8434"],
            ["lan", "LAN — https://192.168.0.200:8434"],
            ["relay", "Current Relay (core.endpointUrl)"]
        ]),
        settingsButtonRow(
            settingsButton("Check for update", "apk-update-check"),
            settingsButton("Download & install", "apk-update-install", { primary: true })
        ),
        settingsHint(hint)
    ];
};

export const registerApkUpdateSettingsContribution = (): (() => void) =>
    registerSettingsContribution({
        id: "apk-update",
        label: "Updates",
        order: 90,
        surfaces: ["capacitor", "native", "environment"],
        render: (ctx: SettingsContributionContext) =>
            settingsPanel("apk-update", "Updates", apkUpdateFields(ctx)),
        load: (settings: AppSettings, panel: HTMLElement) => {
            const src = panel.querySelector(
                '[data-field="shell.apkUpdateSource"]'
            ) as HTMLSelectElement | null;
            if (src) {
                const v = String((settings.shell as { apkUpdateSource?: string } | undefined)?.apkUpdateSource || "wan").trim();
                src.value = v === "lan" || v === "relay" ? v : "wan";
            }
        }
    });

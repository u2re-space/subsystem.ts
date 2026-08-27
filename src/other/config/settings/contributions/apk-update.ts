/*
 * Filename: apk-update.ts
 * FullPath: modules/projects/subsystem/src/other/config/settings/contributions/apk-update.ts
 * FIND:apk-update
 * TAG:sku,apk-update
 * Change date and time: 18.05.00_27.08.2026
 * Reason for changes: Fleet rows show gateway vs installed; newer code or name is an update.
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

/** Sibling APKs the launcher may check / sideload. CRX has no package. */
const FLEET_SKUS: readonly { sku: Exclude<CwspSku, "crx" | "launcher">; label: string }[] = [
    { sku: "explorer", label: "Explorer" },
    { sku: "document", label: "Document" },
    { sku: "process", label: "Process" },
    { sku: "transfer", label: "Transfer" }
];

const skuOf = (ctx: SettingsContributionContext): CwspSku | "" => ctx.sku || readCwspSku();

const versionHint = (sku: CwspSku, text: string): HTMLElement => {
    const p = document.createElement("p");
    p.className = "field-hint";
    p.setAttribute("data-apk-local-version", "1");
    p.setAttribute("data-apk-sku", sku);
    p.textContent = text;
    return p;
};

const skuButtons = (sku: CwspSku): HTMLElement => {
    const check = settingsButton("Check", "apk-update-check");
    const install = settingsButton("Download & install", "apk-update-install", { primary: true });
    check.setAttribute("data-apk-sku", sku);
    install.setAttribute("data-apk-sku", sku);
    return settingsButtonRow(check, install);
};

const fleetRow = (sku: Exclude<CwspSku, "crx">, label: string): HTMLElement => {
    const wrap = document.createElement("div");
    wrap.className = "apk-update-fleet-row";
    wrap.setAttribute("data-apk-sku-row", sku);
    const title = document.createElement("h4");
    title.textContent = label;
    const manifest = apkManifestForSku(sku);
    wrap.append(
        title,
        versionHint(sku, "Not checked — tap Check"),
        skuButtons(sku),
        settingsHint(
            sku === "transfer"
                ? `Reads ${manifest} (ecosystem token). Newer versionCode or versionName is an update.`
                : `Reads ${manifest}. Newer versionCode or versionName is an update.`
        )
    );
    return wrap;
};

const apkUpdateFields = (ctx: SettingsContributionContext): SettingsPanelChild[] => {
    const sku = skuOf(ctx);
    const manifest = sku ? apkManifestForSku(sku) : "";
    const hostSku = readCwspSku();
    const hubSection = String(ctx.hubSection || "hub");
    const fromLauncher = hostSku === "launcher" && sku && sku !== "launcher";
    const showFleet = hostSku === "launcher" && (!ctx.hubSection || hubSection === "hub");

    const hint = fromLauncher
        ? sku === "transfer"
            ? "Updates CWSP-transfer (`latest.json` / space.u2re.cwsp). Needs ecosystem token."
            : `Updates the installed ${sku} APK (${manifest || "channel"}).`
        : sku === "launcher"
          ? "This launcher reads latest-launcher.json. Other ecosystem APKs are listed below when this is the Shell APK."
          : sku === "transfer"
            ? "This hub APK reads latest.json (ecosystem token). Other SKUs are not installed from here."
            : manifest
              ? `This app reads ${manifest} for its own APK only.`
              : "Checks the gateway release that matches this installed package.";

    const fields: SettingsPanelChild[] = [
        showFleet ? "This launcher" : "App update (dev)",
        versionHint((sku || "launcher") as CwspSku, "Installed version: … (tap Check to refresh)"),
        settingsSelectField("Update source", "shell.apkUpdateSource", [
            ["wan", "WAN — https://45.147.121.152:8434"],
            ["lan", "LAN — https://192.168.0.200:8434"],
            ["relay", "Current Relay (core.endpointUrl)"]
        ]),
        skuButtons((sku || "launcher") as CwspSku),
        settingsHint(hint)
    ];

    if (showFleet) {
        fields.push("Ecosystem APKs", settingsHint("Check or install Explorer, Document, Process, and Transfer from this launcher."));
        for (const row of FLEET_SKUS) {
            fields.push(fleetRow(row.sku, row.label));
        }
    }

    return fields;
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

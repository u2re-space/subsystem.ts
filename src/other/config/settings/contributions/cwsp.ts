/*
 * Filename: cwsp.ts
 * FullPath: modules/projects/subsystem/src/other/config/settings/contributions/cwsp.ts
 * Change date and time: 19.25.00_10.07.2026
 * Reason for changes: Ecosystem token + load/save mirror; short destination IDs.
 */
import {
    registerSettingsContribution,
    type SettingsContributionContext
} from "../../SettingsContributions";
import {
    normalizeEcosystemToken,
    resolveEcosystemToken,
    type AppSettings
} from "../../SettingsTypes";
import {
    settingsCheckboxField,
    settingsHint,
    settingsPanel,
    settingsTextField,
    type SettingsPanelChild
} from "../settings-contribution-ui";

const MULTI_VALUE_HINT = "Separate with comma, semicolon, space, or newline. Short IDs: L-110, L-196, L-200, L-208, L-210.";

const connectionFields = (): SettingsPanelChild[] => [
    settingsHint("Persist to IDB; Neutralino/WebNative also syncs to Node portable.config + clipboard-hub."),
    "Connection",
    settingsTextField("Relay / gateway host", "core.endpointUrl", "https://192.168.0.200:8434 or https://45.147.121.152:8434"),
    settingsHint("Coordinator / gateway. Always include :8434 — bare host dials :443 where /ws is not served (404)."),
    settingsTextField("Direct host (optional)", "core.ops.directUrl", "https://192.168.0.110:8434"),
    settingsHint("Optional direct peer (desk). Leave empty when phones only talk via gateway."),
    settingsTextField("Client id", "core.userId", "L-196"),
    settingsHint("Short fleet id (L-196, L-210, …). Used as WS userId/clientId — not airpad-client."),
    settingsTextField("Ecosystem token", "core.ecosystemToken", "shared ecosystem key", "password"),
    settingsHint("One shared token for identification + control (replaces separate identifier / access tokens). Leave blank on Save to keep the stored token."),
    settingsTextField("Destination node ids", "core.socket.routeTarget", "L-196;L-210;L-208"),
    settingsHint(MULTI_VALUE_HINT),
    settingsCheckboxField("Allow insecure TLS", "core.allowInsecureTls")
];

const clipboardFields = (): SettingsPanelChild[] => [
    "Clipboard",
    settingsCheckboxField("Accept inbound clipboard", "shell.acceptInboundClipboardData"),
    settingsCheckboxField("Apply remote clipboard to device", "shell.applyRemoteClipboardToDevice"),
    settingsTextField("Inbound clipboard allow ids", "shell.clipboardInboundAllowIds", "* or L-196;L-210"),
    settingsHint(MULTI_VALUE_HINT),
    settingsTextField("Share-intent destination ids", "shell.clipboardShareDestinationIds", "L-196;L-210;L-110"),
    settingsHint(MULTI_VALUE_HINT)
];

const nativeWireFields = (): SettingsPanelChild[] => [
    "Native wire (Capacitor)",
    settingsCheckboxField("Prefer native Java WebSocket", "core.interop.preferNativeWebsocket"),
    settingsCheckboxField("Maintain hub socket in background", "shell.maintainHubSocketConnection")
];

/** Device toggles folded into CWSP tab on mobile (same `AppSettings.shell` paths). */
const mobileDeviceFields = (): SettingsPanelChild[] => [
    "Device",
    settingsCheckboxField("Start CWSP on boot", "shell.autoStartOnBoot"),
    settingsCheckboxField("Foreground CWSP service", "shell.bridgeDaemonEnabled"),
    settingsCheckboxField("Enable remote clipboard bridge", "shell.enableRemoteClipboardBridge"),
    settingsCheckboxField("Accept contacts bridge", "shell.acceptContactsBridgeData"),
    settingsCheckboxField("Accept SMS bridge", "shell.acceptSmsBridgeData"),
    settingsHint("Save may request contacts / SMS / notifications when those toggles are on.")
];

export const registerCwspSettingsContribution = (): (() => void) =>
    registerSettingsContribution({
        id: "cwsp",
        label: "CWSP",
        order: 55,
        render: (ctx: SettingsContributionContext) => {
            const children: SettingsPanelChild[] = [
                ...connectionFields(),
                ...clipboardFields()
            ];
            if (ctx.surface === "capacitor" || ctx.surface === "native") {
                children.push(...nativeWireFields(), ...mobileDeviceFields());
            } else {
                children.push(...nativeWireFields());
            }
            return settingsPanel("cwsp", "CWSP", children);
        },
        load: (settings: AppSettings, panel: HTMLElement) => {
            // WHY: hydrate single UI field from ecosystemToken or legacy userKey/accessToken.
            const input = panel.querySelector('[data-field="core.ecosystemToken"]') as HTMLInputElement | null;
            if (input) input.value = resolveEcosystemToken(settings);
        },
        save: (settings: AppSettings) => {
            normalizeEcosystemToken(settings);
        }
    });

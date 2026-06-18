import {
    registerSettingsContribution,
    type SettingsContributionContext
} from "../../SettingsContributions";
import {
    settingsCheckboxField,
    settingsHint,
    settingsPanel,
    settingsTextField,
    type SettingsPanelChild
} from "../settings-contribution-ui";

const MULTI_VALUE_HINT = "Separate with comma, semicolon, space, or newline.";

const connectionFields = (): SettingsPanelChild[] => [
    settingsHint("Persist to IDB; on Capacitor syncs to Java prefs via CwsBridge."),
    "Connection",
    settingsTextField("Relay host (IP or domain)", "core.endpointUrl", "192.168.0.200"),
    settingsHint("Coordinator / gateway. Port auto-discovered (8434, 443, …) when omitted."),
    settingsTextField("Direct host (IP or domain)", "core.ops.directUrl", "192.168.0.110"),
    settingsHint("Direct peer / AirPad target."),
    settingsTextField("Client id", "core.userId", "L-192.168.0.196"),
    settingsTextField("Identification token", "core.userKey", "token", "password"),
    settingsTextField("Control / access token", "core.socket.accessToken", "optional", "password"),
    settingsTextField("Destination node ids", "core.socket.routeTarget", "* or L-…;L-…"),
    settingsHint(MULTI_VALUE_HINT),
    settingsCheckboxField("Allow insecure TLS", "core.allowInsecureTls")
];

const clipboardFields = (): SettingsPanelChild[] => [
    "Clipboard",
    settingsCheckboxField("Accept inbound clipboard", "shell.acceptInboundClipboardData"),
    settingsCheckboxField("Apply remote clipboard to device", "shell.applyRemoteClipboardToDevice"),
    settingsTextField("Inbound clipboard allow ids", "shell.clipboardInboundAllowIds", "* or L-…"),
    settingsHint(MULTI_VALUE_HINT),
    settingsTextField("Share-intent destination ids", "shell.clipboardShareDestinationIds", "L-192.168.0.110"),
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
    settingsHint("Save triggers Android permission dialogs / overlay settings when toggles are on.")
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
        }
    });

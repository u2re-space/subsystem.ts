import { registerSettingsContribution } from "../../SettingsContributions";
import {
    settingsCheckboxField,
    settingsHint,
    settingsPanel
} from "../settings-contribution-ui";

/** CRX / extension shell device prefs (Capacitor folds these into the CWSP tab). */
export const registerDeviceSettingsContribution = (): (() => void) =>
    registerSettingsContribution({
        id: "device",
        label: "Extension",
        order: 80,
        surfaces: ["crx"],
        render: () =>
            settingsPanel("device", "Extension preferences", [
                settingsCheckboxField("Start CWSP on boot", "shell.autoStartOnBoot"),
                settingsCheckboxField("Foreground CWSP service", "shell.bridgeDaemonEnabled"),
                settingsCheckboxField("Enable remote clipboard bridge", "shell.enableRemoteClipboardBridge"),
                settingsCheckboxField("Accept contacts bridge", "shell.acceptContactsBridgeData"),
                // WHY: SMS not requested on Android Capacitor; CRX keeps contacts-only device prefs.
                settingsHint("Save may open system permission UI when bridge toggles are enabled.")
            ])
    });

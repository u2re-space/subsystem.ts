import { registerSettingsContribution } from "../../SettingsContributions";
import { settingsCheckboxField, settingsNumberField, settingsPanel } from "../settings-contribution-ui";

/** AirPad view-owned prefs — register from airpad-view or the central bootstrap. */
export const registerAirpadSettingsContribution = (): (() => void) =>
    registerSettingsContribution({
        id: "airpad",
        label: "AirPad",
        order: 70,
        requiresView: "airpad",
        render: () =>
            settingsPanel("airpad", "AirPad", [
                settingsNumberField("Pointer sensitivity", "views.airpad.pointerSensitivity", {
                    min: "0.2",
                    max: "5",
                    step: "0.1",
                    placeholder: "1.0"
                }),
                settingsCheckboxField("Invert scroll", "views.airpad.invertScroll"),
                settingsCheckboxField("Send haptics", "views.airpad.haptics")
            ])
    });

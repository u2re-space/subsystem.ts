import { registerSettingsContribution } from "../../SettingsContributions";
import { settingsCheckboxField, settingsNumberField, settingsPanel } from "../settings-contribution-ui";

export const registerReaderSettingsContribution = (): (() => void) =>
    registerSettingsContribution({
        id: "reader",
        label: "Reader",
        order: 60,
        requiresView: "viewer",
        render: () =>
            settingsPanel("reader", "Reader", [
                settingsNumberField("Default zoom (%)", "views.reader.zoomPercent", {
                    min: "50",
                    max: "300",
                    step: "10",
                    placeholder: "100"
                }),
                settingsCheckboxField("Wrap long lines", "views.reader.wrapLongLines")
            ])
    });

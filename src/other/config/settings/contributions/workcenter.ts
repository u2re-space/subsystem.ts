import { registerSettingsContribution } from "../../SettingsContributions";
import { settingsCheckboxField, settingsPanel, settingsTextField } from "../settings-contribution-ui";

export const registerWorkcenterSettingsContribution = (): (() => void) =>
    registerSettingsContribution({
        id: "workcenter",
        label: "Work Center",
        order: 65,
        requiresView: "workcenter",
        render: () =>
            settingsPanel("workcenter", "Work Center", [
                settingsCheckboxField("Auto-run pinned tasks", "views.workcenter.autoRunPinned"),
                settingsTextField("Default instruction id", "views.workcenter.defaultInstructionId", "(none)")
            ])
    });

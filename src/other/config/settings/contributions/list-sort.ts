/*
 * Filename: list-sort.ts
 * FullPath: modules/projects/subsystem/src/other/config/settings/contributions/list-sort.ts
 * FIND:explorer
 * Change date and time: 22.30.00_29.08.2026
 * Reason for changes: Settings for Explorer list sort.
 */

import { registerSettingsContribution } from "../../SettingsContributions";
import { settingsCheckboxField, settingsHint, settingsPanel, settingsSelectField } from "../settings-contribution-ui";

const EXPLORER_SORT: Array<[string, string]> = [
    ["name", "Name"],
    ["date", "Date modified"],
    ["type", "Type"],
    ["size", "Size"],
    ["kind", "Kind (file / folder)"]
];

const DIR: Array<[string, string]> = [
    ["asc", "Ascending"],
    ["desc", "Descending"]
];

const persistExplorer = (settings: {
    explorer?: { sortBy?: string; sortDir?: string; foldersFirst?: boolean };
}): void => {
    try {
        localStorage.setItem(
            "cwsp-explorer-sort",
            JSON.stringify({
                sortBy: settings.explorer?.sortBy || "name",
                sortDir: settings.explorer?.sortDir || "asc",
                foldersFirst: settings.explorer?.foldersFirst !== false
            })
        );
        window.dispatchEvent(new CustomEvent("cwsp:explorer-sort-change"));
    } catch {
        /* private mode */
    }
};

export const registerExplorerSortSettingsContribution = (): (() => void) =>
    registerSettingsContribution({
        id: "explorer-sort",
        label: "Explorer list",
        order: 25,
        requiresView: "explorer",
        render: () =>
            settingsPanel("explorer-sort", "Explorer list", [
                settingsHint("Order of files and folders in CWSP-explorer / Explorer."),
                settingsSelectField("Sort items by", "explorer.sortBy", EXPLORER_SORT),
                settingsSelectField("Order", "explorer.sortDir", DIR),
                settingsCheckboxField("Folders first", "explorer.foldersFirst")
            ]),
        load: (settings) => {
            let live: { sortBy?: string; sortDir?: string; foldersFirst?: boolean } = {};
            try {
                const raw = localStorage.getItem("cwsp-explorer-sort");
                if (raw) live = JSON.parse(raw) as typeof live;
            } catch {
                /* ignore */
            }
            settings.explorer = {
                ...(settings.explorer || {}),
                sortBy: (live.sortBy || settings.explorer?.sortBy || "name") as NonNullable<
                    typeof settings.explorer
                >["sortBy"],
                sortDir: (live.sortDir || settings.explorer?.sortDir || "asc") as NonNullable<
                    typeof settings.explorer
                >["sortDir"],
                foldersFirst: (live.foldersFirst ?? settings.explorer?.foldersFirst) !== false
            };
        },
        save: (settings) => persistExplorer(settings)
    });

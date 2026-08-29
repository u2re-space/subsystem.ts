/**
 * Central bootstrap for shared settings contributions.
 * Views may also call individual `register*SettingsContribution()` exports
 * (idempotent by contribution id).
 */
import { registerApkUpdateSettingsContribution } from "./contributions/apk-update";
import { registerCwspSettingsContribution } from "./contributions/cwsp";
import { registerDeviceSettingsContribution } from "./contributions/device";
import { registerReaderSettingsContribution } from "./contributions/reader";
import { registerOpenFilesSettingsContribution } from "./contributions/open-files";
import { registerWorkcenterSettingsContribution } from "./contributions/workcenter";
import { registerWorkspaceSettingsContribution } from "./contributions/workspace";
import { registerExplorerSortSettingsContribution } from "./contributions/list-sort";

export { registerApkUpdateSettingsContribution } from "./contributions/apk-update";
export { registerCwspSettingsContribution } from "./contributions/cwsp";
export { registerDeviceSettingsContribution } from "./contributions/device";
export { registerReaderSettingsContribution } from "./contributions/reader";
export { registerOpenFilesSettingsContribution } from "./contributions/open-files";
export { registerWorkcenterSettingsContribution } from "./contributions/workcenter";
export { registerWorkspaceSettingsContribution } from "./contributions/workspace";
export { registerExplorerSortSettingsContribution } from "./contributions/list-sort";

let registered = false;

export const registerBuiltinSettingsContributions = (): void => {
    if (registered) return;
    registered = true;
    registerCwspSettingsContribution();
    registerWorkspaceSettingsContribution();
    registerExplorerSortSettingsContribution();
    registerOpenFilesSettingsContribution();
    registerReaderSettingsContribution();
    registerWorkcenterSettingsContribution();
    registerDeviceSettingsContribution();
    registerApkUpdateSettingsContribution();
};

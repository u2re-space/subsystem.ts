/**
 * Central bootstrap for shared settings contributions.
 * Views may also call individual `register*SettingsContribution()` exports
 * (idempotent by contribution id).
 */
import { registerCwspSettingsContribution } from "./contributions/cwsp";
import { registerDeviceSettingsContribution } from "./contributions/device";
import { registerReaderSettingsContribution } from "./contributions/reader";
import { registerWorkcenterSettingsContribution } from "./contributions/workcenter";
import { registerWorkspaceSettingsContribution } from "./contributions/workspace";

export { registerCwspSettingsContribution } from "./contributions/cwsp";
export { registerDeviceSettingsContribution } from "./contributions/device";
export { registerReaderSettingsContribution } from "./contributions/reader";
export { registerWorkcenterSettingsContribution } from "./contributions/workcenter";
export { registerWorkspaceSettingsContribution } from "./contributions/workspace";

let registered = false;

export const registerBuiltinSettingsContributions = (): void => {
    if (registered) return;
    registered = true;
    registerCwspSettingsContribution();
    registerWorkspaceSettingsContribution();
    registerReaderSettingsContribution();
    registerWorkcenterSettingsContribution();
    registerDeviceSettingsContribution();
};

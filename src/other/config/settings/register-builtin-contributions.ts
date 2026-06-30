/**
 * Central bootstrap for shared settings contributions.
 * Views may also call individual `register*SettingsContribution()` exports
 * (idempotent by contribution id).
 */
import { registerAirpadSettingsContribution } from "./contributions/airpad";
import { registerCwspSettingsContribution } from "./contributions/cwsp";
import { registerDeviceSettingsContribution } from "./contributions/device";
import { registerReaderSettingsContribution } from "./contributions/reader";
import { registerWorkcenterSettingsContribution } from "./contributions/workcenter";

export { registerAirpadSettingsContribution } from "./contributions/airpad";
export { registerCwspSettingsContribution } from "./contributions/cwsp";
export { registerDeviceSettingsContribution } from "./contributions/device";
export { registerReaderSettingsContribution } from "./contributions/reader";
export { registerWorkcenterSettingsContribution } from "./contributions/workcenter";

let registered = false;

export const registerBuiltinSettingsContributions = (): void => {
    if (registered) return;
    registered = true;
    registerCwspSettingsContribution();
    registerReaderSettingsContribution();
    registerWorkcenterSettingsContribution();
    registerAirpadSettingsContribution();
    registerDeviceSettingsContribution();
};

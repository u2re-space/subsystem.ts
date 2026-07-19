/*
 * Filename: device.ts
 * FullPath: modules/projects/subsystem/src/other/config/settings/contributions/device.ts
 * Change date and time: 15.10.00_19.07.2026
 * Reason for changes: CRX Extension prefs live in apps/CrossWord/src/crx/settings/main.ts
 *   (single tab). This registrar is a no-op so builtins stay import-compatible.
 */

/**
 * Former CRX-only "Extension" contribution — removed to avoid duplicate tabs.
 * Capacitor folds device toggles into the CWSP tab; CRX uses the `crx` panel.
 */
export const registerDeviceSettingsContribution = (): (() => void) => () => undefined;

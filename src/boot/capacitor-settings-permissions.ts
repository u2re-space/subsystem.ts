/*
 * Filename: capacitor-settings-permissions.ts
 * FullPath: apps/CWSP-reborn/src/frontend/submodules/shells/boot/capacitor-settings-permissions.ts
 * Change date and time: 07.25.00_12.07.2026
 * Reason for changes: Never request SMS — banking apps flag READ_SMS as malware-like.
 */
/**
 * Capacitor Settings → Android runtime permission / system Intent flow.
 * Called after a successful Settings save on CWSAndroid so toggles trigger
 * the expected system dialogs (contacts, notifications).
 *
 * WHY: SYSTEM_ALERT_WINDOW / permanent overlay bubble was removed — do not
 * open "Display over other apps" on save.
 * INVARIANT: never request READ_SMS / RECEIVE_SMS / SEND_SMS (manifest + plugin too).
 */
import type { AppSettings } from "../other/config/SettingsTypes";
import { isCapacitorNative } from "./capacitor-permissions";

type AnyRecord = Record<string, any>;

const cap = (): AnyRecord | null => {
    try {
        const c = (globalThis as AnyRecord)?.Capacitor;
        return c && typeof c === "object" ? (c as AnyRecord) : null;
    } catch {
        return null;
    }
};

const plugin = (name: string): AnyRecord | null => {
    const p = cap()?.Plugins?.[name];
    return p && typeof p === "object" ? (p as AnyRecord) : null;
};

const callSafe = async (fn: unknown, ...args: unknown[]): Promise<unknown> => {
    try {
        return typeof fn === "function" ? await (fn as (...a: unknown[]) => Promise<unknown>)(...args) : undefined;
    } catch (e) {
        console.warn("[capacitor-settings-permissions]", e);
        return undefined;
    }
};

export type CapacitorSettingsPermissionReport = {
    /** Human-readable lines for the Settings footer note. */
    lines: string[];
    /** Runtime permission rows returned by native (if any). */
    results: Array<{ permission?: string; granted?: boolean }>;
    /** True when the system permission dialog was shown this save. */
    prompted?: boolean;
};

/**
 * After Settings save on native Android, request permissions / open system UI
 * implied by the saved shell toggles.
 */
export const requestCapacitorSettingsPermissionsAfterSave = async (
    settings: AppSettings
): Promise<CapacitorSettingsPermissionReport> => {
    const lines: string[] = [];
    const results: CapacitorSettingsPermissionReport["results"] = [];
    let prompted = false;

    if (!isCapacitorNative()) {
        return { lines, results, prompted };
    }

    // SECURITY: force SMS toggles off on Capacitor — settings remain valid without SMS.
    if (settings.shell) {
        settings.shell.acceptSmsBridgeData = false;
        settings.shell.enableNativeSms = false;
    }

    const shell = settings.shell || {};
    const wantsContacts = shell.acceptContactsBridgeData === true;
    const wantsDaemon = (shell.bridgeDaemonEnabled ?? true) !== false;
    const wantsClipboardBridge = (shell.enableRemoteClipboardBridge ?? true) !== false;
    const wantsNotifications = wantsDaemon || wantsClipboardBridge;

    const platform = plugin("CwsPlatform");

    if (wantsContacts || wantsNotifications) {
        if (platform?.requestSettingsPermissions) {
            const raw = await callSafe(platform.requestSettingsPermissions, {
                contacts: wantsContacts,
                // INVARIANT: never request SMS runtime permissions.
                sms: false,
                notifications: wantsNotifications,
                // WHY: permanent overlay removed — never open draw-over-apps settings.
                overlay: false
            });
            let permPrompted = false;
            if (raw && typeof raw === "object") {
                permPrompted = (raw as AnyRecord).prompted === true;
                prompted = permPrompted;
                const arr = (raw as AnyRecord).results;
                if (Array.isArray(arr)) {
                    for (const row of arr) {
                        if (row && typeof row === "object") {
                            const permission = String((row as AnyRecord).permission ?? "");
                            // Ignore stale overlay / SMS rows from older APKs.
                            if (permission === "SYSTEM_ALERT_WINDOW") continue;
                            if (permission === "READ_SMS" || permission === "RECEIVE_SMS" || permission === "SEND_SMS") {
                                continue;
                            }
                            results.push({
                                permission,
                                granted: Boolean((row as AnyRecord).granted)
                            });
                        }
                    }
                }
            }
            const denied = results.filter((r) => r.granted === false);
            if (denied.length) {
                lines.push(
                    `Permission denied: ${denied.map((r) => r.permission).filter(Boolean).join(", ")}`
                );
            } else if (permPrompted) {
                lines.push("Runtime permissions requested");
            }
            // INVARIANT: already-granted permissions stay silent (no footer noise / false "errors").
        } else {
            const legacy = plugin("DevicePermissions") || plugin("Permissions");
            const perms: string[] = [];
            if (wantsContacts) perms.push("READ_CONTACTS");
            if (wantsNotifications) perms.push("POST_NOTIFICATIONS");
            if (legacy?.requestPermissions && perms.length) {
                await callSafe(legacy.requestPermissions, { permissions: perms });
                lines.push("Runtime permissions requested (legacy plugin)");
            }
        }
    }

    if (wantsDaemon && platform?.startCwspBridge) {
        await callSafe(platform.startCwspBridge);
        lines.push("CWSP foreground service started");
    } else if (!wantsDaemon && platform?.stopCwspBridge) {
        await callSafe(platform.stopCwspBridge);
        lines.push("CWSP foreground service stopped");
    }

    return { lines, results, prompted };
};

/**
 * Capacitor Settings → Android runtime permission / system Intent flow.
 * Called after a successful Settings save on CWSAndroid so toggles trigger
 * the expected system dialogs (contacts, SMS, notifications, overlay).
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

    const shell = settings.shell || {};
    const wantsContacts = shell.acceptContactsBridgeData === true;
    const wantsSms = shell.acceptSmsBridgeData === true;
    const wantsDaemon = (shell.bridgeDaemonEnabled ?? true) !== false;
    const wantsClipboardBridge = (shell.enableRemoteClipboardBridge ?? true) !== false;
    const wantsNotifications = wantsDaemon || wantsClipboardBridge;
    const wantsOverlay = wantsDaemon || wantsClipboardBridge;

    const platform = plugin("CwsPlatform");

    if (wantsContacts || wantsSms || wantsNotifications || wantsOverlay) {
        if (platform?.requestSettingsPermissions) {
            const raw = await callSafe(platform.requestSettingsPermissions, {
                contacts: wantsContacts,
                sms: wantsSms,
                notifications: wantsNotifications,
                overlay: wantsOverlay
            });
            let permPrompted = false;
            if (raw && typeof raw === "object") {
                permPrompted = (raw as AnyRecord).prompted === true;
                prompted = permPrompted;
                const arr = (raw as AnyRecord).results;
                if (Array.isArray(arr)) {
                    for (const row of arr) {
                        if (row && typeof row === "object") {
                            results.push({
                                permission: String((row as AnyRecord).permission ?? ""),
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
            if (wantsSms) perms.push("READ_SMS");
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

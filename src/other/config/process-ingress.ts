/*
 * Filename: process-ingress.ts
 * FullPath: modules/projects/subsystem/src/other/config/process-ingress.ts
 * FIND:process-ingress
 * TAG:process-ingress,share-target,workcenter
 *
 * Per-kind Share Target / Launch Queue policy for CWSP-process.
 * INVARIANT: attach only stages files. process runs AI once (page-side) and
 * optionally writes the result to the device clipboard — never also click Execute.
 * COMPAT: `ai.autoProcessShared === false` forces attach for every kind.
 */

import { OPEN_KINDS, type OpenKind } from "./open-policy";
import type { AppSettings, ProcessIngressKindPolicy, ProcessIngressMode, ProcessIngressPolicy } from "./SettingsTypes";

export type ProcessIngressKind = OpenKind;
export type { ProcessIngressKindPolicy, ProcessIngressMode, ProcessIngressPolicy };

const kindDefault = (mode: ProcessIngressMode, copy: boolean): ProcessIngressKindPolicy => ({
    mode,
    instructionId: "",
    copyToClipboard: copy
});

export const DEFAULT_PROCESS_INGRESS: ProcessIngressPolicy = {
    autoProcess: true,
    backgroundClipboard: true,
    kinds: {
        markdown: kindDefault("process", true),
        text: kindDefault("process", true),
        document: kindDefault("process", true),
        image: kindDefault("process", true),
        url: kindDefault("process", true),
        other: kindDefault("attach", false)
    }
};

export const PROCESS_INGRESS_KIND_LABELS: Record<ProcessIngressKind, string> = {
    markdown: "Markdown",
    text: "Text",
    document: "Documents",
    image: "Images",
    url: "Links",
    other: "Other files"
};

export const mergeProcessIngress = (
    ...layers: Array<Partial<ProcessIngressPolicy> | null | undefined>
): ProcessIngressPolicy => {
    const out: ProcessIngressPolicy = {
        autoProcess: DEFAULT_PROCESS_INGRESS.autoProcess,
        backgroundClipboard: DEFAULT_PROCESS_INGRESS.backgroundClipboard,
        kinds: { ...DEFAULT_PROCESS_INGRESS.kinds }
    };
    for (const layer of layers) {
        if (!layer) continue;
        if (typeof layer.autoProcess === "boolean") out.autoProcess = layer.autoProcess;
        if (typeof layer.backgroundClipboard === "boolean") out.backgroundClipboard = layer.backgroundClipboard;
        if (layer.kinds && typeof layer.kinds === "object") {
            for (const key of OPEN_KINDS) {
                const src = layer.kinds[key];
                if (!src || typeof src !== "object") continue;
                const prev = out.kinds[key];
                out.kinds[key] = {
                    mode: src.mode === "attach" || src.mode === "process" ? src.mode : prev.mode,
                    instructionId: typeof src.instructionId === "string" ? src.instructionId : prev.instructionId,
                    copyToClipboard:
                        typeof src.copyToClipboard === "boolean" ? src.copyToClipboard : prev.copyToClipboard
                };
            }
        }
    }
    return out;
};

export const resolveProcessIngressPolicy = (settings?: AppSettings | null): ProcessIngressPolicy => {
    const merged = mergeProcessIngress(DEFAULT_PROCESS_INGRESS, settings?.ai?.processIngress);
    // COMPAT: older master flag still wins when it is explicitly off.
    if (settings?.ai?.autoProcessShared === false) merged.autoProcess = false;
    return merged;
};

export type ResolvedProcessIngressKind = ProcessIngressKindPolicy & {
    kind: ProcessIngressKind;
    autoProcess: boolean;
    backgroundClipboard: boolean;
};

export const resolveProcessIngressKind = (
    settings: AppSettings | null | undefined,
    kind: string
): ResolvedProcessIngressKind => {
    const policy = resolveProcessIngressPolicy(settings);
    const key = (OPEN_KINDS as readonly string[]).includes(kind) ? (kind as ProcessIngressKind) : "other";
    const row = policy.kinds[key] || DEFAULT_PROCESS_INGRESS.kinds[key];
    const mode: ProcessIngressMode = policy.autoProcess === false ? "attach" : row.mode === "attach" ? "attach" : "process";
    return {
        kind: key,
        mode,
        instructionId: row.instructionId || "",
        copyToClipboard: mode === "process" && row.copyToClipboard !== false,
        autoProcess: policy.autoProcess,
        backgroundClipboard: policy.backgroundClipboard
    };
};

export const instructionTextForIngress = (
    settings: AppSettings | null | undefined,
    instructionId?: string
): string => {
    const list = settings?.ai?.customInstructions || [];
    const id = String(instructionId || "").trim();
    const pick = id
        ? list.find((item) => item.id === id)
        : list.find((item) => item.id === settings?.ai?.activeInstructionId) || null;
    return String(pick?.instruction || "").trim();
};

export const formatProcessIngressResult = (data: unknown): string => {
    if (typeof data === "string") return data;
    if (data == null) return "";
    try {
        return JSON.stringify(data, null, 2);
    } catch {
        return String(data);
    }
};

let settingsPeek: AppSettings | null = null;

export const rememberProcessIngressSettings = (settings?: AppSettings | null): void => {
    if (settings) settingsPeek = settings;
};

export const peekProcessIngressSettings = (): AppSettings | null => settingsPeek;

/** True when a settings blob has been loaded (defaults still apply on Capacitor). */
export const processIngressSettingsFound = (settings?: AppSettings | null): boolean =>
    Boolean(settings?.ai && (settings.ai.processIngress || typeof settings.ai.autoProcessShared === "boolean"));

const isProcessSkuHost = (): boolean => {
    try {
        const fromDom = String(
            (globalThis as { document?: Document }).document?.documentElement?.dataset?.cwspSku || ""
        ).trim();
        if (fromDom === "process") return true;
    } catch {
        /* no document */
    }
    try {
        const loc = String((globalThis as { location?: Location }).location?.hostname || "");
        return /^(process|workcenter|ai)\./i.test(loc);
    } catch {
        return false;
    }
};

const isCapacitorNativeSync = (): boolean => {
    try {
        const g = globalThis as {
            Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
            __CWS_NATIVE__?: boolean;
        };
        return Boolean(
            g.Capacitor?.isNativePlatform?.() ||
                g.Capacitor?.getPlatform?.() === "android" ||
                g.Capacitor?.getPlatform?.() === "ios" ||
                g.__CWS_NATIVE__ === true
        );
    } catch {
        return false;
    }
};

/**
 * INVARIANT: Process PWA/Web is not a Share Target (no `share_target` in the manifest).
 * Capacitor/Android still uses Share + Open-with.
 */
export const allowProcessWebShareLaunch = (settings?: AppSettings | null): boolean => {
    if (!isProcessSkuHost()) return true;
    if (isCapacitorNativeSync()) return true;
    void settings;
    return false;
};

/**
 * INVARIANT: Process PWA/Web consumes Launch Queue like document/explorer (`file_handlers`).
 * Share Target stays off; Open with / file-handler launches still attach in Work Center.
 */
export const allowProcessWebLaunchQueue = (settings?: AppSettings | null): boolean => {
    void settings;
    return true;
};

export const writeProcessIngressClipboard = async (text: string): Promise<boolean> => {
    const value = String(text || "");
    if (!value.trim()) return false;
    try {
        const { writeClipboardTextToDevice } = await import("../../routing/native/clipboard-device");
        await writeClipboardTextToDevice(value);
        return true;
    } catch {
        return false;
    }
};

/** Capacitor: keep the foreground bridge so AI + clipboard-write can finish after Share. */
export const holdCapacitorIngressJob = async (settings?: AppSettings | null): Promise<() => void> => {
    const policy = resolveProcessIngressPolicy(settings);
    try {
        const { isCapacitorNative } = await import("../../boot/capacitor-permissions");
        if (!isCapacitorNative()) return () => {};
    } catch {
        return () => {};
    }
    if (!policy.backgroundClipboard) return () => {};
    try {
        const { ensureCapacitorBridgeDaemonStarted } = await import("../../boot/capacitor-settings-permissions");
        /* WHY: a share-time AI job must keep the foreground bridge even if Settings left the daemon off. */
        await ensureCapacitorBridgeDaemonStarted({
            ...(settings || {}),
            shell: { ...(settings?.shell || {}), bridgeDaemonEnabled: true }
        });
    } catch {
        /* daemon optional */
    }
    return () => {};
};

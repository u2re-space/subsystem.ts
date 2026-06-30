/**
 * Capacitor / WebView frontend log ring + native bridge for AI/agent debugging.
 * Exposes `globalThis.__CWSP_FRONTEND_DEBUG__` and forwards batches to CwsBridge `debug:*`.
 */
import { Capacitor } from "@capacitor/core";
import { CwsBridge } from "com/routing/native/cws-bridge";

export type FrontendDebugLevel = "log" | "info" | "warn" | "error" | "debug" | "trace";

export type FrontendDebugEntry = {
    ts: number;
    level: FrontendDebugLevel;
    scope: string;
    msg: string;
    data?: unknown;
};

export type FrontendDebugApi = {
    entries: FrontendDebugEntry[];
    max: number;
    enabled: boolean;
    tail: (limit?: number) => FrontendDebugEntry[];
    clear: () => void;
    log: (scope: string, level: FrontendDebugLevel, msg: string, data?: unknown) => void;
    flush: () => Promise<void>;
};

const MAX_ENTRIES = 800;
const FLUSH_MS = 2500;

/** Opt-in: full console patch + native flush is expensive on Capacitor WebView. */
const isDebugCaptureEnabled = (): boolean => {
    try {
        const env = (import.meta as { env?: { VITE_CWS_FRONTEND_DEBUG?: string } }).env?.VITE_CWS_FRONTEND_DEBUG;
        if (/^(1|true|yes|on)$/i.test(String(env ?? ""))) return true;
        return globalThis.localStorage?.getItem("cws-frontend-debug") === "1";
    } catch {
        return false;
    }
};
const entries: FrontendDebugEntry[] = [];
const pending: FrontendDebugEntry[] = [];
let installed = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const serializeArg = (value: unknown): string => {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
};

const formatConsoleArgs = (args: unknown[]): { msg: string; data?: unknown } => {
    if (!args.length) return { msg: "" };
    const head = serializeArg(args[0]);
    if (args.length === 1) return { msg: head };
    const rest = args.slice(1).map(serializeArg).filter(Boolean);
    return { msg: rest.length ? `${head} ${rest.join(" ")}` : head, data: args.length > 1 ? args.slice(1) : undefined };
};

const pushEntry = (level: FrontendDebugLevel, scope: string, msg: string, data?: unknown): void => {
    const row: FrontendDebugEntry = { ts: Date.now(), level, scope, msg, data };
    entries.push(row);
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    pending.push(row);
    if (pending.length > 200) pending.splice(0, pending.length - 200);
    scheduleFlush();
};

const scheduleFlush = (): void => {
    if (flushTimer != null) return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushPending();
    }, FLUSH_MS);
};

const flushPending = async (): Promise<void> => {
    if (!pending.length) return;
    if (!Capacitor.isNativePlatform?.()) return;
    if (!api.enabled) {
        pending.length = 0;
        return;
    }
    const batch = pending.splice(0, pending.length);
    try {
        await CwsBridge.invoke({
            channel: "debug:append",
            payload: { entries: batch, peer: "L-192.168.0.196", source: "webview" }
        });
    } catch {
        /* bridge optional during boot */
    }
};

const patchConsole = (): void => {
    const levels: FrontendDebugLevel[] = ["log", "info", "warn", "error", "debug"];
    for (const level of levels) {
        const orig = console[level]?.bind(console);
        if (!orig) continue;
        console[level] = (...args: unknown[]) => {
            try {
                const { msg, data } = formatConsoleArgs(args);
                pushEntry(level, "console", msg, data);
            } catch {
                /* ignore */
            }
            orig(...args);
        };
    }
};

const api: FrontendDebugApi = {
    entries,
    max: MAX_ENTRIES,
    enabled: true,
    tail(limit = 120) {
        const n = Math.max(1, Math.min(limit, entries.length));
        return entries.slice(entries.length - n);
    },
    clear() {
        entries.length = 0;
        pending.length = 0;
    },
    log(scope, level, msg, data) {
        pushEntry(level, scope, msg, data);
    },
    async flush() {
        await flushPending();
    }
};

/** Install error hooks once; console patch + native flush only when explicitly enabled. */
export const initFrontendDebugCapture = (): FrontendDebugApi => {
    if (installed) return api;
    installed = true;

    (globalThis as { __CWSP_FRONTEND_DEBUG__?: FrontendDebugApi }).__CWSP_FRONTEND_DEBUG__ = api;

    const captureVerbose = isDebugCaptureEnabled();
    if (captureVerbose) {
        patchConsole();
    }

    globalThis.addEventListener?.("error", (ev) => {
        const err = ev.error instanceof Error ? ev.error : undefined;
        pushEntry("error", "window", err?.stack || err?.message || String(ev.message || "error"));
    });
    globalThis.addEventListener?.("unhandledrejection", (ev) => {
        pushEntry("error", "promise", serializeArg((ev as PromiseRejectionEvent).reason));
    });

    api.enabled = captureVerbose;
    api.log(
        "boot",
        "info",
        `frontend-debug ready native=${Boolean(Capacitor.isNativePlatform?.())} verbose=${captureVerbose}`
    );
    return api;
};

export const getFrontendDebugApi = (): FrontendDebugApi | undefined =>
    (globalThis as { __CWSP_FRONTEND_DEBUG__?: FrontendDebugApi }).__CWSP_FRONTEND_DEBUG__;

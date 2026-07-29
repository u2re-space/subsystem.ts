/*
 * Filename: shell-preference.ts
 * FullPath: modules/shared/src/boot/shell-preference.ts
 * Change date and time: 09.20.00_29.07.2026
 * Reason for changes: CWSP-shell default is environment on desktop and mobile (launcher / NTP).
 */
/**
 * Cross-window shell default: last-focused / last-interacted window updates
 * `rs-boot-shell-last-active`. Explicit choice stays in `rs-boot-shell` (boot menu, ?shell=, etc.).
 *
 * WHY: CWSP-shell is web-desktop + mobile launcher + Speed Dial / new-tab — default `environment`
 * on all viewports. Users can still pick `minimal` via boot menu when `rs-boot-remember=1`.
 */

import type { ShellId } from "./types";

export const LS_BOOT_SHELL_LAST_ACTIVE = "rs-boot-shell-last-active";
/** Soft legacy default key — when absent or not remembered, prefer `environment`. */
export const LS_BOOT_SHELL = "rs-boot-shell";
export const LS_BOOT_REMEMBER = "rs-boot-remember";

const LAST_ACTIVE_MAX_MS = 30 * 24 * 60 * 60 * 1000;

export function normalizeBootShellId(shell: ShellId | null | undefined): ShellId {
    if (shell === "faint") {
        return "tabbed";
    }
    if (
        shell === "base" ||
        shell === "minimal" ||
        shell === "window" ||
        shell === "tabbed" ||
        shell === "environment" ||
        shell === "content" ||
        shell === "immersive"
    ) {
        return shell;
    }
    return getDefaultBootShellId();
}

/**
 * Narrow / coarse-pointer viewport helper (diagnostics, adaptive chrome).
 * INVARIANT: does **not** force shell id away from `environment` — launcher is mobile-first too.
 */
export function isMobileBootShellViewport(): boolean {
    if (typeof globalThis.matchMedia !== "function") {
        return false;
    }
    try {
        const narrow = globalThis.matchMedia("(max-width: 768px)").matches;
        const coarse = globalThis.matchMedia("(pointer: coarse)").matches;
        const coarseTablet = globalThis.matchMedia("(max-width: 1024px)").matches;
        return narrow || (coarse && coarseTablet);
    } catch {
        return false;
    }
}

/**
 * Viewport coercion for boot shell ids.
 * WHY: previously demoted `environment` → `minimal` on phones; CWSP-shell keeps environment
 * as the launcher/NTP shell on mobile. Pass-through keeps explicit choices intact.
 */
export function coerceShellForBootViewport(shell: ShellId): ShellId {
    return shell;
}

/**
 * Canonical default when no explicit shell preference exists: environment launcher.
 */
export function getDefaultBootShellId(): ShellId {
    return "environment";
}

/**
 * Soft `minimal` from older builds was the implicit default — promote to environment
 * unless the user checked “Remember my choice”.
 */
export function promoteSoftMinimalShellPreference(shell: ShellId): ShellId {
    if (shell !== "minimal") return coerceShellForBootViewport(shell);
    try {
        if (globalThis.localStorage?.getItem(LS_BOOT_REMEMBER) === "1") {
            return "minimal";
        }
    } catch {
        /* ignore */
    }
    try {
        globalThis.localStorage?.setItem(LS_BOOT_SHELL, "environment");
    } catch {
        /* ignore */
    }
    return "environment";
}

type LastActivePayload = { shell: string; t: number };

export function readLastActiveBootShell(): ShellId | null {
    try {
        const raw = globalThis.localStorage?.getItem(LS_BOOT_SHELL_LAST_ACTIVE);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw) as Partial<LastActivePayload>;
        if (typeof parsed.t !== "number" || typeof parsed.shell !== "string") {
            return null;
        }
        if (Date.now() - parsed.t > LAST_ACTIVE_MAX_MS) {
            return null;
        }
        return normalizeBootShellId(parsed.shell as ShellId);
    } catch {
        return null;
    }
}

export function recordBootShellWindowActivity(shellId: ShellId): void {
    try {
        const shell = normalizeBootShellId(shellId);
        const payload: LastActivePayload = { shell, t: Date.now() };
        globalThis.localStorage?.setItem(LS_BOOT_SHELL_LAST_ACTIVE, JSON.stringify(payload));
    } catch {
        // ignore quota / private mode
    }
}

/**
 * Track this tab/window as the last-used shell context (focus + pointer).
 * Returns a dispose function for unmount.
 */
export function initBootShellWindowActivity(shellId: ShellId): () => void {
    const shell = normalizeBootShellId(shellId);
    const onWinFocus = () => recordBootShellWindowActivity(shell);
    const onPointer = () => recordBootShellWindowActivity(shell);

    const w = globalThis as Window & typeof globalThis;
    w.addEventListener("focus", onWinFocus);
    w.addEventListener("pointerdown", onPointer, { capture: true, passive: true });
    queueMicrotask(() => recordBootShellWindowActivity(shell));

    return () => {
        w.removeEventListener("focus", onWinFocus);
        w.removeEventListener("pointerdown", onPointer, { capture: true } as AddEventListenerOptions);
    };
}

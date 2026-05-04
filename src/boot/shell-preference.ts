/**
 * Cross-window shell default: last-focused / last-interacted window updates
 * `rs-boot-shell-last-active`. Explicit choice stays in `rs-boot-shell` (boot menu, ?shell=, etc.).
 *
 * Mobile / small viewports: default to minimal; experimental `environment` is desktop-oriented.
 */

import type { ShellId } from "./types";

export const LS_BOOT_SHELL_LAST_ACTIVE = "rs-boot-shell-last-active";

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
    return "minimal";
}

/**
 * Treat narrow and coarse-pointer layouts as “mobile shell” — prefer minimal shell there.
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

/** Experimental environment shell is not the default on mobile / small screens. */
export function coerceShellForBootViewport(shell: ShellId): ShellId {
    if (!isMobileBootShellViewport()) {
        return shell;
    }
    if (shell === "environment") {
        return "minimal";
    }
    return shell;
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

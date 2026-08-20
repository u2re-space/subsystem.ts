/*
 * Filename: launcher-home-lifecycle.ts
 * FullPath: apps/CWSP-crx/src/shared/routing/native/launcher-home-lifecycle.ts
 * Reason for changes: CRX stub — HOME/back lifecycle is Capacitor launcher SKU only.
 */

export type LauncherHomeLifecycleHooks = {
    navigateHome?: () => void;
    openAppMenu?: () => void;
    closeAppMenu?: () => void;
    isAppMenuOpen?: () => boolean;
    focusSpeedDial?: () => void;
};

const HOOKS_BOOT = "__CWSP_LAUNCHER_HOME_HOOKS_V1__";
const GLOBAL_API = "__CWSP_LAUNCHER_HOME__";

const hookSlot = (): {
    get(): LauncherHomeLifecycleHooks | null;
    set(v: LauncherHomeLifecycleHooks | null): void;
} => {
    const g = globalThis as Record<string, LauncherHomeLifecycleHooks | null>;
    return {
        get: () => (HOOKS_BOOT in g ? g[HOOKS_BOOT] : null),
        set: (v) => {
            g[HOOKS_BOOT] = v;
        }
    };
};

export function isLauncherSku(): boolean {
    return (
        document.documentElement.dataset.cwspShellRole === "launcher" ||
        (globalThis as { __RS_SHELL_ROLE__?: string }).__RS_SHELL_ROLE__ === "launcher"
    );
}

export function registerLauncherHomeLifecycleHooks(hooks: LauncherHomeLifecycleHooks | null): void {
    hookSlot().set(hooks);
}

export function focusLauncherSpeedDial(): void {
    const hooks = hookSlot().get();
    if (typeof hooks?.focusSpeedDial === "function") {
        hooks.focusSpeedDial();
        return;
    }
    const home = document.querySelector<HTMLElement>("#home");
    if (!home) return;
    try {
        home.focus({ preventScroll: true });
    } catch {
        try {
            home.focus();
        } catch {
            /* ignore */
        }
    }
}

export function isLauncherHomeVisible(): boolean {
    return false;
}

export function handleLauncherHomePressed(): void {
    const hooks = hookSlot().get();
    hooks?.closeAppMenu?.();
    hooks?.navigateHome?.();
    focusLauncherSpeedDial();
}

export function handleLauncherBackPress(): boolean {
    const hooks = hookSlot().get();
    if (hooks?.isAppMenuOpen?.()) {
        hooks.closeAppMenu?.();
        return true;
    }
    return false;
}

let installed = false;

export function installLauncherHomeLifecycle(): void {
    if (installed || !isLauncherSku()) return;
    installed = true;
    (globalThis as Record<string, unknown>)[GLOBAL_API] = {
        isHomeVisible: isLauncherHomeVisible,
        handleHomePressed: handleLauncherHomePressed,
        handleBackPress: handleLauncherBackPress
    };
}

export function applyHubSocketFromSettings(settings: unknown): void {
    globalThis.dispatchEvent?.(new CustomEvent("view:hub-socket-settings", { detail: settings }));
}

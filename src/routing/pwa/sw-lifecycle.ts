/*
 * Filename: sw-lifecycle.ts
 * FullPath: modules/projects/subsystem/src/routing/pwa/sw-lifecycle.ts
 * FIND:sw-url
 * TAG:sw-warmup
 *
 * SW install/activate so a new worker does not sit in "waiting to activate".
 * INVARIANT: skipWaiting + clients.claim; SKIP_WAITING is unwrapped (Uniform mail).
 */

type SwScope = {
    skipWaiting?: () => Promise<void> | void;
    clients?: { claim?: () => Promise<void> | void };
    addEventListener?: (type: string, listener: (event: Event) => void) => void;
};

const skipWaitingType = (value: unknown): boolean => {
    if (value == null) return false;
    if (typeof value === "string") return value === "SKIP_WAITING" || value === "skipWaiting";
    if (typeof value !== "object") return false;
    const row = value as Record<string, unknown>;
    const type = String(row.type || row.what || "");
    return type === "SKIP_WAITING" || type === "skipWaiting";
};

export const attachSwLifecycle = (scope: SwScope = self as unknown as SwScope): void => {
    const skip = (): Promise<void> => Promise.resolve(scope.skipWaiting?.()).then(() => undefined);

    scope.addEventListener?.("install", (event) => {
        (event as ExtendableEvent).waitUntil?.(skip());
    });

    scope.addEventListener?.("activate", (event) => {
        (event as ExtendableEvent).waitUntil?.(Promise.resolve(scope.clients?.claim?.()).then(() => undefined));
    });

    scope.addEventListener?.("message", (event) => {
        const data = (event as MessageEvent).data;
        if (!skipWaitingType(data)) return;
        (event as ExtendableEvent).waitUntil?.(skip());
    });
};

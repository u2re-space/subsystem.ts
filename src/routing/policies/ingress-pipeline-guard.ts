/**
 * Throttles share-target / launch-queue style ingress so bursts cannot
 * run more than twice within any 100ms sliding window (additional calls wait).
 */

const WINDOW_MS = 100;
const MAX_IN_WINDOW = 2;

const recentStarts: number[] = [];

const prune = (now: number): void => {
    while (recentStarts.length && now - recentStarts[0]! > WINDOW_MS) {
        recentStarts.shift();
    }
};

/**
 * Wait until a pipeline run is allowed, then record this run.
 * Call once at the start of a share / launch-queue transfer pipeline.
 */
export const waitForIngressPipelineSlot = async (): Promise<void> => {
    const spin = (): Promise<void> =>
        new Promise((r) => {
            globalThis.queueMicrotask(r);
        });

    for (;;) {
        const now = Date.now();
        prune(now);
        if (recentStarts.length < MAX_IN_WINDOW) {
            recentStarts.push(Date.now());
            return;
        }
        const wait = WINDOW_MS - (now - recentStarts[0]!) + 1;
        await new Promise<void>((resolve) => {
            globalThis.setTimeout(resolve, Math.max(0, wait));
        });
        await spin();
    }
};

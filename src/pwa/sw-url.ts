type ProbeResult = {
    ok: boolean;
    url: string;
    contentType?: string | null;
    status?: number;
};

const isLikelyJavaScriptContentType = (contentType: string | null | undefined): boolean => {
    const ct = (contentType || "").toLowerCase();
    return ct.includes("javascript") || ct.includes("ecmascript") || ct.includes("module");
};

const PROBE_TIMEOUT_MS = 8000;

const probeScriptUrl = async (url: string): Promise<ProbeResult> => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            method: "GET",
            cache: "no-store",
            credentials: "same-origin",
            signal: ac.signal,
        });
        const contentType = res.headers.get("content-type");
        return { ok: res.ok && isLikelyJavaScriptContentType(contentType), url, contentType, status: res.status };
    } catch {
        return { ok: false, url };
    } finally {
        clearTimeout(timer);
    }
};

export const getServiceWorkerCandidates = (): string[] => {
    const env = (import.meta as any)?.env;
    const isDev = Boolean(env?.DEV);

    // Dev: vite-plugin-pwa injectManifest serves /dev-sw.js?dev-sw.
    // Keep /sw.js as fallback because setups can vary.
    if (isDev) return ["/dev-sw.js?dev-sw", "/sw.js"];

    // Prod: support both root and /apps/cw/ (Fastify may expose one or both).
    return ["/sw.js", "/apps/cw/sw.js"];
};

export const ensureServiceWorkerRegistered = async (): Promise<ServiceWorkerRegistration | null> => {
    if (typeof window === "undefined") return null;
    if (!("serviceWorker" in navigator)) return null;
    const protocol = (globalThis?.location?.protocol || "").toLowerCase();
    if (protocol === "chrome-extension:" || protocol === "file:" || protocol === "about:") {
        return null;
    }
    if (protocol !== "https:" && protocol !== "http:") {
        return null;
    }

    // Prefer existing registration.
    try {
        const existing = await navigator.serviceWorker.getRegistration("/");
        if (existing?.active || existing?.waiting || existing?.installing) return existing;
    } catch {
        // ignore
    }

    const candidates = getServiceWorkerCandidates();
    const scope = "/";

    for (const url of candidates) {
        const probe = await probeScriptUrl(url);
        if (!probe.ok) continue;

        try {
            return await navigator.serviceWorker.register(url, {
                scope,
                type: "module",
                updateViaCache: "none",
            });
        } catch (e) {
            // Do NOT retry dev worker as classic script: it is module-only.
            if (url.includes("/dev-sw.js?dev-sw")) {
                console.warn("[SW] Module registration failed for dev worker", url, e);
                continue;
            }
            // Fallback for classic workers (legacy /sw.js setups).
            try {
                return await navigator.serviceWorker.register(url, {
                    scope,
                    updateViaCache: "none",
                });
            } catch (e2) {
                // Try next candidate.
                console.warn("[SW] Registration attempt failed for", url, e, e2);
            }
        }
    }

    // Best-effort diagnostics.
    try {
        const probes = await Promise.all(candidates.map(probeScriptUrl));
        console.warn("[SW] No valid service worker script found. Probes:", probes);
    } catch {
        // ignore
    }

    return null;
};


/**
 * PWA service worker URL resolution + registration.
 *
 * NOTE: `import.meta.env.BASE_URL` must match Vite `base` when the app is mounted under a path
 * (e.g. `/apps/cw/`). Scope is derived from the script path (max allowed scope = script directory).
 *
 * Reverse proxies must serve real JS for `sw.js` (not SPA index.html); otherwise the probe fails and
 * registration is skipped (no MIME SecurityError spam).
 *
 * INVARIANT: never register another SKU’s `sw.js` on this origin. Fastify sends
 * `Service-Worker-Allowed: /`, so `/apps/cw/sw.js` can take over `https://u2re.space/`.
 * FIND:sw-url
 * TAG:sw-url,sw-warmup
 */

type ProbeResult = {
    ok: boolean;
    url: string;
    contentType?: string | null;
    status?: number;
};

const isLikelyJavaScriptContentType = (contentType: string | null | undefined): boolean => {
    const ct = (contentType || "").toLowerCase();
    return (
        ct.includes("javascript") ||
        ct.includes("ecmascript") ||
        ct.includes("module") ||
        ct.includes("text/javascript")
    );
};

const isLikelyHtmlContentType = (contentType: string | null | undefined): boolean => {
    const ct = (contentType || "").toLowerCase();
    return ct.includes("text/html") || ct.includes("application/xhtml");
};

/** SPA / proxy fallbacks often return 200 + HTML for unknown paths — never call `register()` in that case (MIME SecurityError spam). */
const bodyLooksLikeHtmlDocument = (snippet: string): boolean => {
    const head = snippet.trimStart().slice(0, 400);
    if (!head) return false;
    return (
        head.startsWith("<!") ||
        /^<\s*html[\s>]/i.test(head) ||
        head.startsWith("<!--")
    );
};

const PROBE_TIMEOUT_MS = 8000;

/** WHY: Vite 8 only inlines `import.meta.env.DEV` / `BASE_URL` on the exact member access — `(import.meta as any).env.DEV` stays undefined and we only probe `/sw.js` (SPA HTML). */
const isViteDev = (): boolean => import.meta.env.DEV === true || Boolean(import.meta.hot);

const viteBaseUrl = (): string => String(import.meta.env.BASE_URL ?? "/");

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
        const status = res.status;

        if (!res.ok) {
            return { ok: false, url, contentType, status };
        }

        if (isLikelyHtmlContentType(contentType)) {
            return { ok: false, url, contentType, status };
        }

        if (isLikelyJavaScriptContentType(contentType)) {
            return { ok: true, url, contentType, status };
        }

        // Ambiguous Content-Type (some CDNs/proxies omit it): sniff a small prefix.
        try {
            const text = await res.clone().text();
            const sample = text.trimStart().slice(0, 2048);
            if (bodyLooksLikeHtmlDocument(sample)) {
                return { ok: false, url, contentType, status };
            }
            const looksJs =
                /^\s*(?:\/\/|\/\*|import\s|export\s|self\.|'use strict'|"use strict")/m.test(sample) ||
                /\b(?:addEventListener|serviceWorker|workbox|skipWaiting|caches\.|navigator\.serviceWorker)\b/.test(
                    sample
                );
            if (looksJs) {
                return { ok: true, url, contentType, status };
            }
        } catch {
            /* ignore */
        }

        return { ok: false, url, contentType, status };
    } catch {
        return { ok: false, url };
    } finally {
        clearTimeout(timer);
    }
};

/** Legacy markdown path-mount (not `md.u2re.space`). */
const isCwMarkdownMount = (): boolean => {
    try {
        const p = String(globalThis?.location?.pathname || "");
        return p === "/apps/cw" || p.startsWith("/apps/cw/");
    } catch {
        return false;
    }
};

const scriptPathname = (scriptURL: string): string => {
    try {
        const origin =
            typeof globalThis !== "undefined" && (globalThis as { location?: { origin?: string } }).location?.origin
                ? String((globalThis as { location: { origin: string } }).location.origin)
                : "https://invalid.invalid";
        return new URL(scriptURL, `${origin}/`).pathname;
    } catch {
        return "";
    }
};

/** `/apps/cw/sw.js` on `u2re.space/` is a leftover from the old path SKU. */
const isForeignSkuWorkerScript = (scriptURL: string): boolean => {
    const path = scriptPathname(scriptURL);
    const isCwScript = path === "/apps/cw/sw.js" || path.startsWith("/apps/cw/");
    return isCwScript && !isCwMarkdownMount();
};

/**
 * Drop workers whose script 404s or belongs to another SKU.
 * WHY: `getRegistration()` returns a zombie `/apps/cw/sw.js` after markdown moved hosts.
 */
export const dropStaleServiceWorkerRegistrations = async (): Promise<void> => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    let regs: readonly ServiceWorkerRegistration[] = [];
    try {
        regs = await navigator.serviceWorker.getRegistrations();
    } catch {
        return;
    }
    for (const reg of regs) {
        const src = reg.active?.scriptURL || reg.waiting?.scriptURL || reg.installing?.scriptURL || "";
        if (!src || isForeignSkuWorkerScript(src)) {
            if (src) console.warn("[SW] Unregistering foreign SKU worker:", src);
            await reg.unregister().catch(() => {});
            continue;
        }
        const probe = await probeScriptUrl(src);
        if (probe.ok) continue;
        console.warn("[SW] Unregistering worker with dead script:", src, probe.status);
        await reg.unregister().catch(() => {});
    }
};

/** Vite base (e.g. `/` or `/apps/cw/`) — normalized with trailing slash. */
const viteBasePrefix = (): string => {
    const raw = viteBaseUrl();
    if (raw === "/" || raw === "") return "/";
    return raw.endsWith("/") ? raw : `${raw}/`;
};

/**
 * When the dev build used `base: "/"` but the app is opened under a subpath (reverse proxy or
 * `/apps/cw/`), `import.meta.env.BASE_URL` is wrong and SW probes miss the real `…/dev-sw.js?dev-sw`.
 */
const inferMountBaseFromPathname = (): string | null => {
    try {
        const pathname = String(globalThis?.location?.pathname || "");
        const m = pathname.match(/^(\/apps\/cw)(?:\/|$)/);
        if (m?.[1]) {
            const p = m[1];
            return p.endsWith("/") ? p : `${p}/`;
        }
    } catch {
        /* ignore */
    }
    return null;
};

/** Collect distinct URL prefixes (vite BASE_URL + path inference) for SW script candidates. */
const serviceWorkerPathBases = (): string[] => {
    const primary = viteBasePrefix();
    const inferred = inferMountBaseFromPathname();
    const out: string[] = [];
    const push = (b: string) => {
        const n = b === "" ? "/" : b.endsWith("/") ? b : `${b}/`;
        if (!out.includes(n)) out.push(n);
    };
    push(primary);
    if (inferred && inferred !== primary) push(inferred);
    return out;
};

/**
 * Default SW scope for a script URL (browser allows at most the script’s directory).
 * `/sw.js` → `/` ; `/apps/cw/sw.js` → `/apps/cw/`
 */
export const scopeForServiceWorkerScript = (swUrl: string): string => {
    try {
        const origin = typeof globalThis !== "undefined" && (globalThis as any).location?.origin
            ? String((globalThis as any).location.origin)
            : "https://invalid.invalid";
        const path = new URL(swUrl, `${origin}/`).pathname;
        const slash = path.lastIndexOf("/");
        return slash <= 0 ? "/" : path.slice(0, slash + 1);
    } catch {
        return "/";
    }
};

export const getServiceWorkerCandidates = (): string[] => {
    const isDev = isViteDev();
    const bases = serviceWorkerPathBases();

    const perBaseDev: string[] = [];
    const perBaseProd: string[] = [];
    for (const b of bases) {
        perBaseDev.push(`${b}dev-sw.js?dev-sw`);
        if (b !== "/") {
            perBaseDev.push(`${b}sw.js`);
            perBaseProd.push(`${b}sw.js`);
        }
    }

    const devFallbacks = ["/dev-sw.js?dev-sw", "/sw.js"];

    // Prod: only this SKU’s script. `/apps/cw/sw.js` is not a fallback on `/`.
    let prod = ["/sw.js"];
    if (isCwMarkdownMount()) {
        prod = ["/apps/cw/sw.js", "/sw.js"];
    }

    const merged = isDev
        ? [...perBaseDev, ...devFallbacks, ...perBaseProd]
        : [...new Set([...perBaseProd, ...prod, "/dev-sw.js?dev-sw"])];
    return [...new Set(merged)];
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

    await dropStaleServiceWorkerRegistrations();

    // Prefer existing registration for *this* document (subpath deployments: not scope `/`).
    const tryGet = async (clientUrl: string | undefined): Promise<ServiceWorkerRegistration | undefined> => {
        if (!clientUrl) return undefined;
        try {
            return (await navigator.serviceWorker.getRegistration(clientUrl)) ?? undefined;
        } catch {
            return undefined;
        }
    };

    try {
        const href = typeof globalThis !== "undefined" ? (globalThis as any).location?.href : "";
        let existing = await tryGet(href);
        if (!existing?.active && !existing?.waiting && !existing?.installing) {
            const origin = typeof globalThis !== "undefined" && (globalThis as any).location?.origin
                ? String((globalThis as any).location.origin)
                : "";
            const base = viteBasePrefix();
            if (origin && base !== "/") {
                existing = await tryGet(new URL(base, origin).href);
            }
        }
        if (!existing?.active && !existing?.waiting && !existing?.installing) {
            const origin = typeof globalThis !== "undefined" && (globalThis as any).location?.origin
                ? String((globalThis as any).location.origin)
                : "";
            if (origin) {
                existing = await tryGet(new URL("/", origin).href);
            }
        }
        if (existing?.active || existing?.waiting || existing?.installing) return existing;
    } catch {
        // ignore
    }

    const candidates = getServiceWorkerCandidates();

    const tryRegister = async (url: string): Promise<ServiceWorkerRegistration | null> => {
        const scope = scopeForServiceWorkerScript(url);
        const isDevVirtualWorker = url.includes("/dev-sw.js?dev-sw");

        // VitePWA `devOptions.type: "module"` emits `import.meta` — classic register throws
        // "Cannot use 'import.meta' outside a module". Prod `sw.js` is IIFE (injectManifest).
        if (isDevVirtualWorker) {
            try {
                return await navigator.serviceWorker.register(url, {
                    scope,
                    type: "module",
                    updateViaCache: "none",
                });
            } catch (eModule) {
                if (isViteDev()) {
                    console.warn("[SW] Dev worker registration failed (module)", url, eModule);
                }
                return null;
            }
        }

        try {
            return await navigator.serviceWorker.register(url, {
                scope,
                updateViaCache: "none",
            });
        } catch (eClassic) {
            if (isViteDev()) {
                console.warn("[SW] Registration failed for", url, eClassic);
            }
            return null;
        }
    };

    // WHY: Probe before register — reverse proxies that SPA-fallback `sw.js` to index.html return
    // `text/html`; calling `register()` then floods the console with uncatchable MIME SecurityErrors.
    for (const url of candidates) {
        const probe = await probeScriptUrl(url);
        if (!probe.ok) continue;

        const reg = await tryRegister(url);
        if (reg) return reg;
    }

    if (isViteDev()) {
        try {
            const probes = await Promise.all(candidates.map(probeScriptUrl));
            console.warn("[SW] No service worker registered; candidates exhausted. Dev probes:", probes);
        } catch {
            /* ignore */
        }
    }

    return null;
};


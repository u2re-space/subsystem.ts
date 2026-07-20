/*
 * Filename: crx-control-session.ts
 * FullPath: modules/projects/subsystem/src/other/config/settings/crx-control-session.ts
 * Change date and time: 20.55.00_20.07.2026
 * Reason for changes: Chrome extension Control pairing — persistent X-Control-Session
 *   in chrome.storage.local (unlike SPA sessionStorage ≤ 1h).
 *   Loopback Control is HTTP-only — never https://127.0.0.1:8434 (SSL protocol error).
 */

/** chrome.storage.local key — never sessionStorage (must survive browser restart). */
export const CRX_CONTROL_SESSION_KEY = "cwsp-control-session-v1";

export type CrxControlSession = {
    token: string;
    /** Bound Origin (chrome-extension://&lt;id&gt;). */
    origin: string;
    /** Control HTTP origin used when pairing (e.g. http://127.0.0.1:29110). */
    controlHost: string;
    expiresAt: number;
    persistent: true;
    pairedAt: number;
};

const chromeApi = (): typeof chrome | null => {
    try {
        return typeof chrome !== "undefined" && chrome?.storage?.local ? chrome : null;
    } catch {
        return null;
    }
};

/** INVARIANT: Origin used for pair/begin must match later X-Control-Session validation. */
export const crxExtensionOrigin = (): string => {
    try {
        const c = chromeApi();
        if (c?.runtime?.id) return `chrome-extension://${c.runtime.id}`;
    } catch {
        /* ignore */
    }
    try {
        const o = String((globalThis as { location?: { origin?: string } }).location?.origin || "")
            .trim()
            .replace(/\/+$/, "");
        if (o.toLowerCase().startsWith("chrome-extension://")) return o;
    } catch {
        /* ignore */
    }
    return "";
};

export const readCrxControlSession = async (): Promise<CrxControlSession | null> => {
    const c = chromeApi();
    if (!c) return null;
    try {
        const bag = await c.storage.local.get(CRX_CONTROL_SESSION_KEY);
        const raw = bag?.[CRX_CONTROL_SESSION_KEY] as CrxControlSession | undefined;
        if (!raw || typeof raw !== "object") return null;
        const token = String(raw.token || "").trim();
        const origin = String(raw.origin || "").trim();
        const controlHost = String(raw.controlHost || "").trim();
        const expiresAt = Number(raw.expiresAt) || 0;
        if (!token || !origin || expiresAt <= Date.now()) return null;
        return {
            token,
            origin,
            controlHost,
            expiresAt,
            persistent: true,
            pairedAt: Number(raw.pairedAt) || 0
        };
    } catch {
        return null;
    }
};

export const writeCrxControlSession = async (session: CrxControlSession): Promise<void> => {
    const c = chromeApi();
    if (!c) return;
    await c.storage.local.set({ [CRX_CONTROL_SESSION_KEY]: session });
};

export const clearCrxControlSession = async (): Promise<void> => {
    const c = chromeApi();
    if (!c) return;
    try {
        await c.storage.local.remove(CRX_CONTROL_SESSION_KEY);
    } catch {
        /* ignore */
    }
};

export const hasValidCrxControlSession = async (): Promise<boolean> =>
    Boolean(await readCrxControlSession());

/** Session token for Control HTTP when Origin is chrome-extension://. */
export const getCrxControlSessionToken = async (): Promise<string> => {
    const s = await readCrxControlSession();
    return s?.token || "";
};

const normalizeDeviceCode = (raw: string): string =>
    String(raw || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Pair CRX with desk/phone Control (publicToken + live 20s deviceCode).
 * Desk Neutralino auto-accepts; Android may require Accept notification.
 */
export const pairCrxControl = async (opts: {
    controlOrigin: string;
    publicToken: string;
    deviceCode: string;
}): Promise<{ ok: true; session: CrxControlSession } | { ok: false; error: string }> => {
    const origin = crxExtensionOrigin();
    if (!origin) return { ok: false, error: "Missing chrome-extension origin" };
    // INVARIANT: loopback Control is HTTP — rewrite https://127.0.0.1:8434 → http.
    const controlHost = toControlHttpOrigin(opts.controlOrigin);
    const publicToken = String(opts.publicToken || "").trim();
    const deviceCode = normalizeDeviceCode(opts.deviceCode);
    if (!controlHost) return { ok: false, error: "Control host required" };
    if (!publicToken || publicToken.length < 8) {
        return { ok: false, error: "Public token required" };
    }
    if (!deviceCode || deviceCode.length < 4) {
        return { ok: false, error: "Device code required" };
    }

    let beginBody: {
        pairId?: string;
        session?: string;
        sessionExpiresAt?: number;
        state?: string;
        error?: string;
    };
    const crxHeaders = (extra?: Record<string, string>): Record<string, string> => ({
        "Content-Type": "application/json",
        "X-Skip-Legacy-Key": "1",
        // WHY: Chromium may omit Origin on loopback; server trusts this for session bind/auth.
        "X-Control-Origin": origin,
        ...(extra || {})
    });

    try {
        const res = await fetch(`${controlHost}/service/pair/begin`, {
            method: "POST",
            headers: crxHeaders(),
            body: JSON.stringify({
                origin,
                publicToken,
                deviceCode,
                clientLabel: `chrome-crx ${origin}`
            }),
            cache: "no-store",
            credentials: "omit"
        });
        beginBody = (await res.json().catch(() => ({}))) as typeof beginBody;
        if (!res.ok) {
            return {
                ok: false,
                error: String(beginBody?.error || `Pairing failed (HTTP ${res.status})`)
            };
        }
        console.log(
            "[CRX Control] pair/begin ok",
            controlHost,
            "session=",
            Boolean(beginBody?.session),
            "state=",
            beginBody?.state
        );
    } catch {
        return { ok: false, error: "Cannot reach Control (is Neutralino/Capacitor running?)" };
    }

    let sessionToken = String(beginBody?.session || "").trim();
    let expiresAt = Number(beginBody?.sessionExpiresAt) || 0;
    const pairId = String(beginBody?.pairId || "").trim();

    // COMPAT: Android Accept path — poll until session delivered or timeout.
    if (!sessionToken && pairId) {
        const deadline = Date.now() + 55_000;
        while (Date.now() < deadline && !sessionToken) {
            await sleep(800);
            try {
                const st = await fetch(
                    `${controlHost}/service/pair/status?pairId=${encodeURIComponent(pairId)}`,
                    {
                        method: "GET",
                        headers: crxHeaders(),
                        cache: "no-store",
                        credentials: "omit"
                    }
                );
                const body = (await st.json().catch(() => ({}))) as {
                    session?: string;
                    sessionExpiresAt?: number;
                    state?: string;
                };
                if (body?.session) {
                    sessionToken = String(body.session).trim();
                    expiresAt = Number(body.sessionExpiresAt) || expiresAt;
                    break;
                }
                if (body?.state === "denied" || body?.state === "expired") {
                    return { ok: false, error: `Pairing ${body.state}` };
                }
            } catch {
                /* retry */
            }
        }
    }

    if (!sessionToken) {
        return {
            ok: false,
            error: "No session yet — Accept the pair on the phone, or check the device code"
        };
    }
    if (!expiresAt || expiresAt < Date.now()) {
        // WHY: persistent CRX TTL is long; if server omits expiry, keep a far-future local stamp.
        expiresAt = Date.now() + 10 * 365 * 24 * 60 * 60_000;
    }

    // INVARIANT: only treat as paired after /service/config accepts the session.
    try {
        const verify = await fetch(`${controlHost}/service/config`, {
            method: "GET",
            headers: crxHeaders({ "X-Control-Session": sessionToken }),
            cache: "no-store",
            credentials: "omit"
        });
        if (!verify.ok) {
            return {
                ok: false,
                error:
                    `Session rejected by Control at ${controlHost} (HTTP ${verify.status})` +
                    (verify.status === 401 || verify.status === 403
                        ? " — redeploy Neutralino (Origin-less CRX session fix + chrome-extension allowlist)"
                        : "")
            };
        }
    } catch {
        return { ok: false, error: "Cannot verify session against /service/config" };
    }

    const session: CrxControlSession = {
        token: sessionToken,
        origin,
        controlHost,
        expiresAt,
        persistent: true,
        pairedAt: Date.now()
    };
    await writeCrxControlSession(session);
    return { ok: true, session };
};

/** Refresh status text for CWSP tab Control pairing UI. */
export const formatCrxControlSessionStatus = async (): Promise<string> => {
    const s = await readCrxControlSession();
    if (!s) return "Control: not paired — Copy & Share / Paste by CWSP disabled";
    const host = s.controlHost.replace(/^https?:\/\//i, "");
    return `Control: paired (persistent) → ${host}`;
};

const normalizeControlOrigin = (raw: string): string =>
    String(raw || "")
        .trim()
        .replace(/\/+$/, "");

const isLoopbackHostname = (host: string): boolean => {
    const h = String(host || "")
        .trim()
        .toLowerCase()
        .replace(/^\[|\]$/g, "");
    return h === "127.0.0.1" || h === "localhost" || h === "::1";
};

/**
 * INVARIANT: desk Neutralino Control RPC is plain HTTP on loopback.
 * HTTPS to :8434 hits the hub TLS socket (or nothing) → ERR_SSL_PROTOCOL_ERROR.
 */
const toControlHttpOrigin = (raw: string): string => {
    const n = normalizeControlOrigin(raw);
    if (!n) return "";
    try {
        const u = new URL(/^https?:\/\//i.test(n) ? n : `http://${n}`);
        const host = u.hostname || "127.0.0.1";
        let port = u.port;
        if (!port) port = u.protocol === "https:" ? "8434" : "80";
        if (port === "443" || port === "80") port = "8434";
        if (isLoopbackHostname(host)) return `http://${host === "::1" ? "[::1]" : host}:${port}`;
        return `${u.protocol}//${host}:${port}`;
    } catch {
        return n.replace(/^https:/i, "http:");
    }
};

/**
 * Candidate Control HTTP origins (Local hub + Neutralino sidecar).
 * WHY: never offer https://127.0.0.1 — Control listen is HTTP.
 */
export const crxControlPairCandidateOrigins = (
    localHubUrl?: string,
    preferred: string[] = []
): string[] => {
    const out: string[] = [];
    const push = (raw: string) => {
        const o = toControlHttpOrigin(raw);
        if (o) out.push(o);
    };
    for (const p of preferred) push(p);
    // INVARIANT: Neutralino Settings UI reads display from :29110 — pair there first.
    push("http://127.0.0.1:29110");
    push(localHubUrl || "");
    try {
        const ds = String(
            (globalThis as { document?: { documentElement?: { dataset?: DOMStringMap } } }).document
                ?.documentElement?.dataset?.cwspControlOrigin || ""
        ).trim();
        if (ds) push(ds);
    } catch {
        /* ignore */
    }
    push("http://127.0.0.1:8434");
    for (let p = 29111; p <= 29114; p++) push(`http://127.0.0.1:${p}`);
    // Dedupe but keep :29110 first.
    const seen = new Set<string>();
    const ranked: string[] = [];
    for (const o of out) {
        if (seen.has(o)) continue;
        seen.add(o);
        ranked.push(o);
    }
    ranked.sort((a, b) => {
        const score = (x: string) => (/:29110$/.test(x) ? 0 : /:8434$/.test(x) ? 2 : 1);
        return score(a) - score(b);
    });
    return ranked;
};

const HELLO_TIMEOUT_MS = 900;

export type ControlHelloInfo = {
    origin: string;
    surface: string;
    publicTokenSuffix: string;
};

/** Probe Control pairing hello (surface + token suffix for UI match). */
export const probeControlPairHello = async (
    controlOrigin: string
): Promise<ControlHelloInfo | null> => {
    const origin = toControlHttpOrigin(controlOrigin);
    if (!origin) return null;
    try {
        const signal =
            typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
                ? AbortSignal.timeout(HELLO_TIMEOUT_MS)
                : undefined;
        const res = await fetch(`${origin}/service/pair/hello`, {
            method: "GET",
            headers: { "X-Skip-Legacy-Key": "1" },
            cache: "no-store",
            credentials: "omit",
            signal
        });
        if (!res.ok) return null;
        const body = (await res.json().catch(() => null)) as {
            pairing?: boolean;
            ok?: boolean;
            deviceCodePeriodMs?: number;
            publicTokenSuffix?: string;
            control?: { surface?: string; publicTokenSuffix?: string };
        } | null;
        if (!body || !(body.pairing === true || body.ok === true || Number(body.deviceCodePeriodMs) > 0)) {
            return null;
        }
        return {
            origin,
            surface: String(body.control?.surface || "").trim(),
            publicTokenSuffix: String(
                body.publicTokenSuffix || body.control?.publicTokenSuffix || ""
            ).trim()
        };
    } catch {
        return null;
    }
};

/** Live Neutralino Control origins — prefer :29110 / surface=neutralino-node. */
export const discoverLiveControlOrigins = async (
    candidates: string[]
): Promise<ControlHelloInfo[]> => {
    const ordered = [...new Set(candidates.map(toControlHttpOrigin).filter(Boolean))];
    const probed = await Promise.all(ordered.map((o) => probeControlPairHello(o)));
    let live = probed.filter((x): x is ControlHelloInfo => Boolean(x));
    // Prefer authentic Neutralino Control when fingerprint is present.
    const neut = live.filter((x) => x.surface === "neutralino-node");
    if (neut.length) live = neut;
    live.sort((a, b) => {
        const score = (x: ControlHelloInfo) =>
            /:29110$/.test(x.origin) ? 0 : x.surface === "neutralino-node" ? 1 : 2;
        return score(a) - score(b);
    });
    if (live.length) {
        console.log(
            "[CRX Control] pair hello live:",
            live.map((x) => `${x.origin}(${x.surface || "?"};…${x.publicTokenSuffix || "????"})`).join(", ")
        );
        return live;
    }
    console.warn(
        "[CRX Control] no /service/pair/hello — falling back to :29110 then :8434"
    );
    return [
        { origin: "http://127.0.0.1:29110", surface: "", publicTokenSuffix: "" },
        { origin: "http://127.0.0.1:8434", surface: "", publicTokenSuffix: "" }
    ];
};

/**
 * Open pairing modal, then pair against Neutralino Control (:29110 first).
 */
export const pairCrxControlWithModal = async (opts?: {
    localHubUrl?: string;
    preferredOrigins?: string[];
}): Promise<{ ok: true; session: CrxControlSession } | { ok: false; error: string; cancelled?: boolean }> => {
    const { showCrxControlPairModal, clearCrxPublicTokenHint } = await import(
        "./crx-control-pair-modal"
    );
    const existing = await readCrxControlSession();
    const preferred = [
        "http://127.0.0.1:29110",
        ...(opts?.preferredOrigins || []),
        ...(existing?.controlHost ? [existing.controlHost] : [])
    ];
    const live = await discoverLiveControlOrigins(
        crxControlPairCandidateOrigins(opts?.localHubUrl, preferred)
    );
    const primary = live[0];
    let lastError = "";
    let ignoreHint = false;
    for (let attempt = 0; attempt < 3; attempt++) {
        const creds = await showCrxControlPairModal({
            error: lastError || undefined,
            title: attempt ? "Pair Control — try again" : "Pair Control",
            publicTokenSuffix: primary?.publicTokenSuffix,
            controlOrigin: primary?.origin,
            ignoreStoredHint: ignoreHint || attempt > 0
        });
        if (!creds) return { ok: false, error: "Cancelled", cancelled: true };
        // WHY: if UI token ends with a different suffix than hello, fail before begin spam.
        const suffix = primary?.publicTokenSuffix || "";
        if (suffix && !creds.publicToken.endsWith(suffix)) {
            await clearCrxPublicTokenHint();
            ignoreHint = true;
            lastError = `Public token must end with …${suffix} (copy from Neutralino CWSP → Control pairing, then Refresh).`;
            continue;
        }
        const result = await pairCrxControlAuto({
            publicToken: creds.publicToken,
            deviceCode: creds.deviceCode,
            localHubUrl: opts?.localHubUrl,
            preferredOrigins: preferred,
            liveHosts: live
        });
        if (result.ok) return result;
        lastError = result.error;
        if (/invalid public token/i.test(result.error)) {
            await clearCrxPublicTokenHint();
            ignoreHint = true;
            lastError =
                `Invalid public token for ${primary?.origin || ":29110"}` +
                (suffix ? ` (expected …${suffix})` : "") +
                " — copy again from Neutralino after Refresh / Regenerate.";
            continue;
        }
        if (/invalid|expired|origin not allowed/i.test(result.error)) {
            if (/origin not allowed/i.test(result.error)) {
                lastError =
                    "Origin not allowed — redeploy Neutralino on desk (chrome-extension Control allowlist).";
            }
            continue;
        }
        return result;
    }
    return { ok: false, error: lastError || "Pairing failed" };
};

/** Pair against already-discovered live Control hosts (29110 first). */
export const pairCrxControlAuto = async (opts: {
    publicToken: string;
    deviceCode: string;
    localHubUrl?: string;
    preferredOrigins?: string[];
    liveHosts?: ControlHelloInfo[];
}): Promise<{ ok: true; session: CrxControlSession } | { ok: false; error: string }> => {
    const live =
        opts.liveHosts && opts.liveHosts.length
            ? opts.liveHosts
            : await discoverLiveControlOrigins(
                  crxControlPairCandidateOrigins(opts.localHubUrl, [
                      "http://127.0.0.1:29110",
                      ...(opts.preferredOrigins || [])
                  ])
              );
    if (!live.length) {
        return {
            ok: false,
            error: "No Neutralino Control on loopback HTTP (:29110 / :8434). Is desk Neutralino running?"
        };
    }
    let lastError = "Pairing failed";
    for (const host of live) {
        console.log("[CRX Control] pair/begin →", host.origin);
        const result = await pairCrxControl({
            controlOrigin: host.origin,
            publicToken: opts.publicToken,
            deviceCode: opts.deviceCode
        });
        if (result.ok) return result;
        lastError = result.error;
        console.warn("[CRX Control] pair/begin failed", host.origin, result.error);
        if (/invalid|expired device|public token|origin not allowed|session rejected/i.test(result.error)) {
            return result;
        }
    }
    return { ok: false, error: lastError };
};

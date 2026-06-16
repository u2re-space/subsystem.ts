/**
 * CWSP endpoint host parsing + port discovery.
 *
 * WHY: AirPad / CWSAndroid / settings should accept bare IP or domain (no `https://`,
 * no port). When the port is omitted we probe common HTTPS/HTTP ports via `/lna-probe`.
 */

export const CWSP_DEFAULT_HTTPS_PORTS = [7443, 9443, 18443, 8443, 8444, 8445, 443] as const;
export const CWSP_DEFAULT_HTTP_PORTS = [8080, 8081, 8082, 18080, 80, 8888] as const;

export type ParsedConnectHost = {
    raw: string;
    host: string;
    port?: string;
    protocol?: "http" | "https";
};

export type DiscoverEndpointResult = {
    origin: string;
    protocol: "http" | "https";
    port: string;
    host: string;
};

export type DiscoverEndpointOptions = {
    timeoutMs?: number;
    preferHttps?: boolean;
    includeHttp?: boolean;
    httpsPorts?: readonly number[];
    httpPorts?: readonly number[];
    fetchFn?: typeof fetch;
    /** Node server probes: allow self-signed LAN certs when false (default true = verify). */
    rejectUnauthorized?: boolean;
};

const trim = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const isLikelyPort = (value: string): boolean => /^\d{1,5}$/.test(value);

const stripProtocol = (value: string): string =>
    trim(value).replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0];

export const looksLikeConnectHost = (value: string): boolean => {
    const t = trim(value);
    if (!t) return false;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return true;
    if (t.startsWith("localhost")) return true;
    if (t.includes("/")) return true;
    if (/^\[[0-9a-f:]+\](?::\d{1,5})?$/i.test(t)) return true;
    if (/^\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?$/.test(t)) return true;
    if (/^[^.\s:]+:\d{1,5}$/.test(t)) return true;
    if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d{1,5})?$/i.test(t)) return true;
    return false;
};

/** Parse user input into host / optional port / optional protocol. */
export const parseConnectHostInput = (raw: string): ParsedConnectHost | null => {
    const trimmed = trim(raw);
    if (!trimmed) return null;

    let protocol: "http" | "https" | undefined;
    let hostSpec = trimmed;
    const protoMatch = trimmed.match(/^([a-z][a-z0-9+.-]*):\/\//i);
    if (protoMatch) {
        const p = protoMatch[1].toLowerCase();
        if (p === "http" || p === "https") protocol = p;
        hostSpec = stripProtocol(trimmed);
    }

    hostSpec = hostSpec.split("/")[0]?.trim() || "";
    if (!hostSpec) return null;

    const at = hostSpec.lastIndexOf(":");
    if (at > 0) {
        const host = hostSpec.slice(0, at).trim();
        const port = hostSpec.slice(at + 1).trim();
        if (host && isLikelyPort(port)) {
            return { raw: trimmed, host, port, protocol };
        }
    }

    return { raw: trimmed, host: hostSpec, protocol };
};

export const hasExplicitConnectPort = (raw: string): boolean => {
    const parsed = parseConnectHostInput(raw);
    return Boolean(parsed?.port);
};

/** Normalize to `protocol://host:port/` when port or protocol is known; otherwise return bare host. */
export const normalizeConnectHostInput = (raw: string): string => {
    const parsed = parseConnectHostInput(raw);
    if (!parsed) return "";
    const { host, port, protocol } = parsed;
    if (!host) return "";

    if (port) {
        const proto =
            protocol ||
            (CWSP_DEFAULT_HTTPS_PORTS.some((p) => String(p) === port)
                ? "https"
                : CWSP_DEFAULT_HTTP_PORTS.some((p) => String(p) === port)
                  ? "http"
                  : "https");
        return `${proto}://${host}:${port}/`;
    }

    if (protocol) return `${protocol}://${host}/`;
    return host;
};

/** Legacy alias used by CWSAndroid settings. */
export const normalizeHttpsOrigin = (value: string): string => normalizeConnectHostInput(value);

const originFromParts = (protocol: "http" | "https", host: string, port: number | string): string =>
    `${protocol}://${host}:${port}/`;

/** Build ordered HTTP(S) origin candidates for probing (deduped). */
export const buildEndpointOriginCandidates = (
    raw: string,
    opts: DiscoverEndpointOptions = {}
): string[] => {
    const parsed = parseConnectHostInput(raw);
    if (!parsed?.host) return [];

    const preferHttps = opts.preferHttps !== false;
    const includeHttp = opts.includeHttp !== false;
    const httpsPorts = opts.httpsPorts ?? CWSP_DEFAULT_HTTPS_PORTS;
    const httpPorts = opts.httpPorts ?? CWSP_DEFAULT_HTTP_PORTS;

    const out: string[] = [];
    const push = (origin: string): void => {
        if (origin && !out.includes(origin)) out.push(origin);
    };

    const { host, port, protocol } = parsed;

    if (port) {
        if (protocol === "https") {
            push(originFromParts("https", host, port));
            return out;
        }
        if (protocol === "http") {
            push(originFromParts("http", host, port));
            return out;
        }
        // WHY: WAN/LAN hosts may serve plain HTTP on 8443 while config still says https://host:8443.
        push(originFromParts("https", host, port));
        if (includeHttp) push(originFromParts("http", host, port));
        return out;
    }

    if (protocol === "https") {
        for (const p of httpsPorts) push(originFromParts("https", host, p));
        return out;
    }
    if (protocol === "http") {
        for (const p of httpPorts) push(originFromParts("http", host, p));
        return out;
    }

    const protocols: Array<"http" | "https"> = preferHttps
        ? includeHttp
            ? ["https", "http"]
            : ["https"]
        : includeHttp
          ? ["http", "https"]
          : ["https"];

    for (const proto of protocols) {
        const ports = proto === "https" ? httpsPorts : httpPorts;
        for (const p of ports) push(originFromParts(proto, host, p));
    }
    return out;
};

/** Map HTTPS/HTTP origin to canonical `/ws` URL. */
export const httpsOriginToWsUrl = (origin: string): string => {
    const trimmed = trim(origin);
    if (!trimmed) return "";
    if (/^wss?:\/\//i.test(trimmed)) {
        try {
            const u = new URL(trimmed);
            if (!u.pathname || u.pathname === "/") u.pathname = "/ws";
            return u.toString();
        } catch {
            return trimmed;
        }
    }
    if (/^https?:\/\//i.test(trimmed)) {
        try {
            const u = new URL(trimmed);
            u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
            if (!u.pathname || u.pathname === "/") u.pathname = "/ws";
            u.search = "";
            u.hash = "";
            return u.toString();
        } catch {
            return "";
        }
    }

    const normalized = normalizeConnectHostInput(origin);
    if (!normalized) return "";

    const candidates = buildEndpointOriginCandidates(normalized);
    const first = candidates[0] || (normalized.includes("://") ? normalized : "");
    if (!first) return "";
    try {
        const u = new URL(first);
        u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
        u.pathname = "/ws";
        u.search = "";
        u.hash = "";
        return u.toString();
    } catch {
        return "";
    }
};

/** Build ordered `/ws` URL candidates from bare host, origin, or legacy wss URL. */
export const buildWsUrlCandidates = (raw: string, opts: DiscoverEndpointOptions = {}): string[] => {
    const trimmed = trim(raw);
    if (!trimmed) return [];
    if (/^wss?:\/\//i.test(trimmed)) {
        try {
            const u = new URL(trimmed);
            if (!u.pathname || u.pathname === "/") u.pathname = "/ws";
            return [u.toString()];
        } catch {
            return [trimmed];
        }
    }

    const out: string[] = [];
    for (const origin of buildEndpointOriginCandidates(trimmed, opts)) {
        const ws = httpsOriginToWsUrl(origin);
        if (ws && !out.includes(ws)) out.push(ws);
    }
    return out;
};

const defaultFetch = (): typeof fetch | undefined => {
    try {
        return typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined;
    } catch {
        return undefined;
    }
};

const DEFAULT_PROBE_TIMEOUT_MS = 2500;

/** Best-effort reachability probe (CWSP `/lna-probe`). */
export const probeEndpointOrigin = async (
    origin: string,
    opts: DiscoverEndpointOptions = {}
): Promise<boolean> => {
    const fetchFn = opts.fetchFn ?? defaultFetch();
    if (!fetchFn) return false;
    const base = trim(origin).replace(/\/+$/, "");
    if (!base) return false;

    const timeoutMs = opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
    const timer =
        controller && timeoutMs > 0
            ? globalThis.setTimeout(() => controller.abort(), timeoutMs)
            : undefined;

    try {
        const res = await fetchFn(`${base}/lna-probe`, {
            method: "GET",
            mode: "cors",
            cache: "no-store",
            credentials: "omit",
            signal: controller?.signal
        } as RequestInit);
        // WHY: reverse proxies on :443 may answer /lna-probe with 200 but not upgrade /ws.
        return res.status === 204;
    } catch {
        return false;
    } finally {
        if (timer) clearTimeout(timer);
    }
};

const resultFromOrigin = (origin: string): DiscoverEndpointResult | null => {
    try {
        const u = new URL(origin);
        return {
            origin,
            protocol: u.protocol === "http:" ? "http" : "https",
            port: u.port || (u.protocol === "http:" ? "80" : "443"),
            host: u.hostname
        };
    } catch {
        return null;
    }
};

/** Probe common ports; returns the first reachable CWSP origin. */
export const discoverEndpointOrigin = async (
    raw: string,
    opts: DiscoverEndpointOptions = {}
): Promise<DiscoverEndpointResult | null> => {
    const parsed = parseConnectHostInput(raw);
    if (!parsed?.host) return null;

    if (parsed.port) {
        const tryOrigin = async (proto: "http" | "https"): Promise<DiscoverEndpointResult | null> => {
            const candidate = originFromParts(proto, parsed.host, parsed.port!);
            if (!(await probeEndpointOrigin(candidate, opts))) return null;
            return resultFromOrigin(candidate);
        };
        if (parsed.protocol === "https") {
            const hit = await tryOrigin("https");
            if (hit) return hit;
        } else if (parsed.protocol === "http") {
            const hit = await tryOrigin("http");
            if (hit) return hit;
        } else {
            const httpsHit = await tryOrigin("https");
            if (httpsHit) return httpsHit;
            if (opts.includeHttp !== false) {
                const httpHit = await tryOrigin("http");
                if (httpHit) return httpHit;
            }
        }
        // WHY: stored `:8443` / `:443` may be stale when the endpoint bound a fallback port.
    }

    for (const origin of buildEndpointOriginCandidates(parsed.host, opts)) {
        if (!(await probeEndpointOrigin(origin, opts))) continue;
        const hit = resultFromOrigin(origin);
        if (hit) return hit;
    }
    return null;
};

const hasExplicitOrigin = (raw: string): boolean => {
    const t = trim(raw);
    if (!t) return false;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return true;
    return Boolean(parseConnectHostInput(t)?.port);
};

/** Resolve bare host / partial URL to a full origin; probes alternate ports when the configured one is down. */
export const resolveConnectHostToOrigin = async (
    raw: string,
    opts: DiscoverEndpointOptions & { discover?: boolean } = {}
): Promise<string> => {
    const trimmed = trim(raw);
    if (!trimmed) return "";
    const shouldDiscover = opts.discover !== false && !hasExplicitOrigin(trimmed);
    if (shouldDiscover) {
        const found = await discoverEndpointOrigin(trimmed, opts);
        if (found?.origin) return found.origin;
    }
    return normalizeConnectHostInput(trimmed);
};

/** Resolve CWSP settings URL fields that may be bare hosts. */
export const resolveCwspUrlFields = async (
    fields: { relayHttpsUrl?: string; directHttpsUrl?: string },
    opts: DiscoverEndpointOptions = {}
): Promise<{ relayHttpsUrl?: string; directHttpsUrl?: string }> => {
    const out: { relayHttpsUrl?: string; directHttpsUrl?: string } = {};
    if (fields.relayHttpsUrl !== undefined) {
        out.relayHttpsUrl = await resolveConnectHostToOrigin(fields.relayHttpsUrl, opts);
    }
    if (fields.directHttpsUrl !== undefined) {
        out.directHttpsUrl = await resolveConnectHostToOrigin(fields.directHttpsUrl, opts);
    }
    return out;
};

/** Node-side `/lna-probe` fetch with optional insecure TLS (self-signed LAN certs). */
export const createNodeProbeFetch = (rejectUnauthorized = true): typeof fetch => {
    return ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            return Promise.reject(new TypeError(`Invalid URL: ${url}`));
        }
        const isHttps = parsed.protocol === "https:";
        const modName = isHttps ? "node:https" : "node:http";
        return import(modName).then(({ request }) =>
            new Promise<Response>((resolve, reject) => {
                const req = request(
                    url,
                    {
                        method: (init?.method || "GET").toUpperCase(),
                        rejectUnauthorized: isHttps ? rejectUnauthorized : undefined
                    },
                    (res) => {
                        res.resume();
                        resolve(new Response(null, { status: res.statusCode || 0 }));
                    }
                );
                req.on("error", reject);
                init?.signal?.addEventListener?.("abort", () => req.destroy());
                req.end();
            })
        );
    }) as typeof fetch;
};

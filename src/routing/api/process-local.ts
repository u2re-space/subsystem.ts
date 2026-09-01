/*
 * Filename: process-local.ts
 * FullPath: modules/projects/subsystem/src/routing/api/process-local.ts
 * FIND:process
 *
 * OpenAI-compatible Process API fallback. Same contract as Fastify process-local:
 * no server env key — only credentials on the request body.
 * INVARIANT: SW, Vite Dev, Fastify, and Java share this shape (`fallback: "local"`).
 */
export const PROCESS_LOCAL_DEFAULT_BASE_URL = "https://api.proxyapi.ru/openai/v1";
export const PROCESS_LOCAL_DEFAULT_MODEL = "gpt-5.6-luna";

const pick = (...values: unknown[]): string => {
    for (const value of values) {
        const text = String(value || "").trim();
        if (text) return text;
    }
    return "";
};

export const hasProcessRequestCredential = (body: unknown): boolean => {
    if (!body || typeof body !== "object") return false;
    const row = body as Record<string, unknown>;
    const provider = row.provider && typeof row.provider === "object" ? (row.provider as Record<string, unknown>) : {};
    return Boolean(pick(row.apiKey, row.bearerToken, row.token, provider.apiKey, provider.bearerToken));
};

export const processApiMissPayload = (source = "local"): Record<string, unknown> => ({
    ok: false,
    error: "Missing credentials",
    layer: "api",
    fallback: source
});

export const processApiJsonResponse = (json: unknown, status = 200): Response =>
    new Response(JSON.stringify(json), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
        }
    });

/** OpenAI-compatible completion when CWSP core / VDS is down. */
export const runLocalProcessFallback = async (
    body: Record<string, unknown> | null | undefined,
    source = "local"
): Promise<Record<string, unknown> | null> => {
    if (!body || typeof body !== "object") return null;
    const apiKey = pick(body.apiKey, body.bearerToken, body.token, (body.provider as { apiKey?: string })?.apiKey);
    if (!apiKey) return null;
    const input = pick(body.input, body.text, body.url, body.content);
    if (!input) return { ok: false, error: "Missing input (text/url/input)", fallback: source };

    const baseUrl = pick(body.baseUrl, (body.provider as { baseUrl?: string })?.baseUrl, PROCESS_LOCAL_DEFAULT_BASE_URL).replace(
        /\/+$/,
        ""
    );
    const model = pick(body.model, (body.provider as { model?: string })?.model, PROCESS_LOCAL_DEFAULT_MODEL);
    const instruction = pick(body.customInstruction);
    const messages = [
        ...(instruction ? [{ role: "system", content: instruction }] : []),
        { role: "user", content: input }
    ];

    try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify({ model, messages })
        });
        const json = (await res.json().catch(() => null)) as {
            error?: { message?: string };
            choices?: Array<{ message?: { content?: string } }>;
        } | null;
        if (!res.ok) {
            return {
                ok: false,
                error: String(json?.error?.message || `Provider ${res.status}`),
                layer: "api",
                fallback: source
            };
        }
        const text = String(json?.choices?.[0]?.message?.content || "").trim();
        if (!text) return { ok: false, error: "Empty provider response", fallback: source };
        return {
            ok: true,
            mode: String(body.mode || "smartRecognize"),
            customInstruction: Boolean(instruction),
            provider: { baseUrl, model, apiKeySource: "request" },
            result: { ok: true, text },
            fallback: source
        };
    } catch (error) {
        return {
            ok: false,
            error: String(error instanceof Error ? error.message : error),
            layer: "api",
            fallback: source
        };
    }
};

export const handleProcessApiPost = async (
    body: Record<string, unknown> | null | undefined,
    source = "local"
): Promise<Record<string, unknown>> => {
    const local = await runLocalProcessFallback(body, source);
    return local ?? processApiMissPayload(source);
};

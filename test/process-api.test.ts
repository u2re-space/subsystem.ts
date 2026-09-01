import assert from "node:assert/strict";
import test from "node:test";

import { CWSP_CORE_FLEET_PORT, skuChannelPorts } from "../src/routing/api/sku-ports.ts";
import {
    PROCESS_API_PUBLIC_ORIGIN,
    isProcessApiPath,
    isProcessApiUnavailable,
    needsRemoteProcessApi,
    processApiAuthFromSettings,
    processApiSuffixFromPath,
    readProcessApiResultText,
    resolveProcessApiUrl
} from "../src/routing/api/process-api.ts";
import {
    hasProcessRequestCredential,
    handleProcessApiPost,
    processApiMissPayload
} from "../src/routing/api/process-local.ts";
import { isProcessApiRequest } from "../src/routing/api/process-api-sw.ts";

const withLocation = (hostname: string, protocol = "https:", run: () => void): void => {
    const prev = (globalThis as { location?: unknown }).location;
    (globalThis as { location: { hostname: string; protocol: string } }).location = { hostname, protocol };
    try {
        run();
    } finally {
        if (prev === undefined) delete (globalThis as { location?: unknown }).location;
        else (globalThis as { location: unknown }).location = prev;
    }
};

test("dedicated process hosts stay same-origin", () => {
    for (const host of ["process.u2re.space", "workcenter.u2re.space", "ai.u2re.space", "u2re.space"]) {
        withLocation(host, "https:", () => {
            assert.equal(needsRemoteProcessApi(), false);
            assert.equal(resolveProcessApiUrl("processing"), "/api/process/processing");
            assert.equal(resolveProcessApiUrl("health"), "/api/process/health");
        });
    }
});

test("LAN and localhost POST to process.u2re.space", () => {
    for (const host of ["192.168.0.200", "127.0.0.1", "localhost"]) {
        withLocation(host, "https:", () => {
            assert.equal(needsRemoteProcessApi(), true);
            assert.equal(
                resolveProcessApiUrl("processing"),
                `${PROCESS_API_PUBLIC_ORIGIN}/api/process/processing`
            );
        });
    }
});

test("isProcessApiPath covers public and legacy routes", () => {
    assert.equal(isProcessApiPath("/api/process"), true);
    assert.equal(isProcessApiPath("/api/process/health"), true);
    assert.equal(isProcessApiPath("/api/process/processing"), true);
    assert.equal(isProcessApiPath("/process/ai/recognize"), true);
    assert.equal(isProcessApiPath("/workcenter"), false);
    assert.equal(isProcessApiPath("/"), false);
});

test("processApiSuffixFromPath and auth + result helpers", () => {
    assert.equal(processApiSuffixFromPath("/process/ai/recognize"), "recognize");
    assert.equal(processApiSuffixFromPath("/api/process/processing"), "processing");
    const auth = processApiAuthFromSettings({
        core: { userId: "u1", userKey: "k1", socket: { accessToken: "tok" } },
        ai: { apiKey: "sk-test" }
    });
    assert.equal(auth.userId, "u1");
    assert.equal(auth.apiKey, "sk-test");
    assert.equal(auth.accessToken, "tok");
    assert.equal(readProcessApiResultText({ ok: true, result: { text: "hello" } }), "hello");
    assert.equal(readProcessApiResultText({ ok: false, error: "nope", result: { text: "hello" } }), "");
    assert.equal(isProcessApiUnavailable({ ok: false, status: 502, json: { ok: false, layer: "api" } }), true);
    assert.equal(isProcessApiUnavailable({ ok: true, status: 200, json: { ok: true, result: { text: "x" } } }), false);
});

test("local fallback misses without a request key", async () => {
    assert.equal(hasProcessRequestCredential({ text: "hi" }), false);
    assert.equal(hasProcessRequestCredential({ apiKey: "sk-test" }), true);
    const miss = await handleProcessApiPost({ text: "hi" }, "test");
    assert.equal(miss.ok, false);
    assert.equal(miss.error, "Missing credentials");
    assert.equal(processApiMissPayload("sw").fallback, "sw");
    assert.equal(isProcessApiRequest("/api/process/processing", "POST"), true);
    assert.equal(isProcessApiRequest("/workcenter", "POST"), false);
});

test("SKU channel ports do not bind core :8434", () => {
    assert.equal(CWSP_CORE_FLEET_PORT, 8434);
    assert.equal(skuChannelPorts("process").fleetWs, 8436);
    assert.equal(skuChannelPorts("process").ssre, 8455);
    for (const id of ["process", "shell", "explorer", "document"] as const) {
        const ports = skuChannelPorts(id);
        assert.notEqual(ports.fleetWs, CWSP_CORE_FLEET_PORT);
        assert.notEqual(ports.ssre, CWSP_CORE_FLEET_PORT);
    }
});

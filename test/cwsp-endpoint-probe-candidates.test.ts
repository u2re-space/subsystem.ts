import assert from "node:assert/strict";
import test from "node:test";

import {
    collectEndpointProbeCandidates,
    normalizeProbeHttpsOrigin,
    splitConnectHostList
} from "../runtime/cwsp-endpoint-resolve.ts";

test("splitConnectHostList splits comma/semicolon endpoint lists", () => {
    assert.deepEqual(splitConnectHostList("45.147.121.152:8434, 192.168.0.200:8434"), [
        "45.147.121.152:8434",
        "192.168.0.200:8434"
    ]);
});

test("collectEndpointProbeCandidates appends LAN fallback after configured WAN", () => {
    const candidates = collectEndpointProbeCandidates({
        relay: "https://45.147.121.152:8434/"
    });
    assert.equal(candidates[0], "https://45.147.121.152:8434");
    assert.ok(candidates.includes("https://192.168.0.200:8434"));
});

test("normalizeProbeHttpsOrigin defaults bare host to :8434", () => {
    assert.equal(normalizeProbeHttpsOrigin("192.168.0.200"), "https://192.168.0.200:8434");
});

import assert from "node:assert/strict";
import test from "node:test";

import { normalizeWsEndpointUrl } from "../src/boot/native-socket.ts";

test("normalizes legacy Socket.IO endpoint URLs to native /ws", () => {
    const actual = normalizeWsEndpointUrl(
        "https://192.168.0.200:8443/socket.io/?EIO=4&transport=websocket&cwsp_route=L-192.168.0.110",
        { cwsp_via: "tunnel" },
        { clientId: "L-192.168.0.196", token: "redacted-token" }
    );

    const parsed = new URL(actual);
    assert.equal(parsed.protocol, "wss:");
    assert.equal(parsed.hostname, "192.168.0.200");
    assert.equal(parsed.port, "8443");
    assert.equal(parsed.pathname, "/ws");
    assert.equal(parsed.searchParams.get("cwsp_route"), "L-192.168.0.110");
    assert.equal(parsed.searchParams.get("cwsp_via"), "tunnel");
    assert.equal(parsed.searchParams.get("clientId"), "L-192.168.0.196");
    assert.equal(parsed.searchParams.get("token"), "redacted-token");
    assert.equal(parsed.searchParams.has("EIO"), false);
    assert.equal(parsed.searchParams.has("transport"), false);
});

test("normalizes host-only endpoints to secure native /ws", () => {
    assert.equal(normalizeWsEndpointUrl("45.147.121.152:8443"), "wss://45.147.121.152:8443/ws");
});

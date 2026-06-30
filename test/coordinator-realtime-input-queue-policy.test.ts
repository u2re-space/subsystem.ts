import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve("src/boot/websocket.ts"), "utf8");

assert.ok(
    /const\s+isRealtimeInputAct\s*=\s*\(what:\s*string\):\s*boolean\s*=>/.test(source),
    "coordinator transport must classify realtime input acts"
);
assert.ok(
    /normalized\s*===\s*"mouse:move"\s*\|\|\s*normalized\s*===\s*"mouse:scroll"/.test(source),
    "mouse move/scroll are live-only controller packets"
);

const sendBody = source.match(/export function sendCoordinatorAct\([\s\S]*?\n\}/)?.[0] || "";
const realtimeGuardIndex = sendBody.indexOf("isRealtimeInputAct(what)");
const queuePushIndex = sendBody.indexOf("queuedCoordinatorActs.push(packet)");

assert.ok(realtimeGuardIndex >= 0, "sendCoordinatorAct must guard realtime input before queueing");
assert.ok(queuePushIndex >= 0, "sendCoordinatorAct must still queue non-realtime coordinator acts");
assert.ok(
    realtimeGuardIndex < queuePushIndex,
    "realtime AirPad deltas must be dropped before they can enter reconnect replay queue"
);

console.info("coordinator realtime input queue policy ok");

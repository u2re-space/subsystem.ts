import assert from "node:assert/strict";
import test from "node:test";

import {
    isCacheApiKey,
    safeCacheMatch,
    safeCacheOpen,
    safeCachesKeys,
    safeCachesMatch,
    toCacheRequestInfo
} from "../src/routing/pwa/sw-cache.ts";
import { shareLandingPath, SHARE_LANDING_BY_SKU } from "../src/routing/pwa/sw-sku-landing.ts";

test("Cache helpers no-op when Cache Storage is missing", async () => {
    assert.equal(await safeCacheMatch(undefined, "/share-target-data"), undefined);
    assert.equal(await safeCacheMatch({} as Cache, "/share-target-data"), undefined);
    assert.equal(await safeCachesMatch("/share-target-data"), undefined);
    assert.equal(await safeCacheOpen("share-target-data"), null);
    assert.deepEqual(await safeCachesKeys(), []);
});

test("isCacheApiKey accepts http(s) and extension URLs, rejects blob", () => {
    assert.equal(isCacheApiKey("/share-target-data"), true);
    assert.equal(isCacheApiKey("https://process.u2re.space/workcenter"), true);
    assert.equal(isCacheApiKey("chrome-extension://abc/popup.html"), true);
    assert.equal(isCacheApiKey("blob:https://process.u2re.space/1"), false);
    assert.equal(toCacheRequestInfo(new URL("https://md.u2re.space/viewer")), "https://md.u2re.space/viewer");
});

test("share landing stays on the owning SKU", () => {
    assert.equal(shareLandingPath("process"), "/workcenter?shared=1");
    assert.equal(shareLandingPath("document"), "/viewer?shared=1");
    assert.equal(shareLandingPath("explorer"), "/?shared=1");
    assert.equal(shareLandingPath("launcher"), SHARE_LANDING_BY_SKU.launcher);
    assert.equal(shareLandingPath(""), "/?shared=1");
});

/*
 * Filename: sw-sku-landing.ts
 * FullPath: modules/projects/subsystem/src/routing/pwa/sw-sku-landing.ts
 * FIND:sw-cache
 * TAG:sku,share-target
 *
 * Share-target 302 landing per fleet SKU.
 * INVARIANT: dedicated hosts live at `/`. Hard-nav `/viewer` or `/workcenter` remounts the SPA.
 */
import { inferCwspSkuFromLocation, type CwspSku } from "../../other/config/ecosystem-skus.ts";

export const SHARE_LANDING_BY_SKU: Record<CwspSku, string> = {
    /* WHY: process.u2re.space `/workcenter` remounts `/` and drops in-memory share Files. */
    process: "/?shared=1",
    /* WHY: md.u2re.space `/viewer` remounts `/` and drops in-memory share Files. */
    document: "/?shared=1",
    explorer: "/?shared=1",
    transfer: "/?shared=1",
    launcher: "/?shared=1",
    crx: "/?shared=1"
};

/** Process default — Work Center consumes `?shared=1` + share cache. */
export const PROCESS_SHARE_LANDING_PATH = SHARE_LANDING_BY_SKU.process;

export const shareLandingPath = (sku?: CwspSku | ""): string => {
    const id = sku || inferCwspSkuFromLocation() || "";
    if (id && id in SHARE_LANDING_BY_SKU) return SHARE_LANDING_BY_SKU[id as CwspSku];
    return SHARE_LANDING_BY_SKU.launcher;
};

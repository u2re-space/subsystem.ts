/*
 * Filename: sw-sku-landing.ts
 * FullPath: modules/projects/subsystem/src/routing/pwa/sw-sku-landing.ts
 * FIND:sw-cache
 * TAG:sku,share-target
 *
 * Share-target 302 landing per fleet SKU.
 * INVARIANT: Explorer stays `/`, document stays viewer, process stays Work Center.
 */
import { inferCwspSkuFromLocation, type CwspSku } from "../../other/config/ecosystem-skus.ts";

export const SHARE_LANDING_BY_SKU: Record<CwspSku, string> = {
    process: "/workcenter?shared=1",
    document: "/viewer?shared=1",
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

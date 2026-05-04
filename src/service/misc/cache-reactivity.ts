/**
 * Indirection so the CRX build can alias this module to a tiny stub (see `vite.config.js` createCrxConfig)
 * without pulling `fest/object` into `com/app.js` for the MV3 service worker graph.
 */
export { observe, iterated, safe } from "fest/object";

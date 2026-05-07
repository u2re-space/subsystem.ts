/**
 * Vite/views alias target for `com/config/Names`.
 * Re-export the canonical module so stubs never drift from subsystem exports
 * (`BROADCAST_CHANNELS`, `COMPONENTS`, `ROUTE_HASHES`, etc.).
 */
export * from "../src/other/config/Names.ts";

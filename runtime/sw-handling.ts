/**
 * Re-export the real PWA / share-target implementations.
 * WHY: Older aliases pointed `core/pwa/sw-handling` at this runtime file as a harmless stub,
 * which broke AirPad (`initServiceWorker` no-op) and any tooling that relied on core/pwa imports.
 */
export * from "../src/routing/pwa/sw-handling";

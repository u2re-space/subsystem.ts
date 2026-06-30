/**
 * Vite/views alias target for `com/core/UnifiedMessaging`.
 * Re-export canonical implementation so stubs never miss protocol helpers
 * (`createProtocolEnvelope`, `sendProtocolMessage`, etc.).
 */
export * from "../src/routing/channel/UnifiedMessaging.ts";

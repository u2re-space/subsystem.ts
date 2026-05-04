/**
 * Shells module public surface.
 *
 * Keep this file as the canonical shell barrel so shell implementations
 * can import shared shell symbols without creating circular self-exports.
 */

export * from "./types";
export * from "./shells";

export * from "shared/routing/registry";
export { ShellRegistry, ViewRegistry, getDefaultBootConfig } from "shared/routing/registry";

export { BaseShell, createShell as createBaseShell } from "./base";
export { ContentShell, createShell as createContentShell } from "./content";

export * from "./registry";

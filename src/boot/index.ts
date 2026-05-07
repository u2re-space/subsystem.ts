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

export * from "./registry";

/**
 * `shells/boot` path target: BootLoader + routing + PWA/CRX entrypoints (canonical: `subsystem/src/boot`).
 */
export * from "boot/ts/routing";
export * from "boot/ts/BootLoader";
export { default } from "boot/ts/BootLoader";
export { default as bootLoader } from "boot/ts/BootLoader";
export { default as frontend, frontend as mountFrontend } from "boot/ts/frontend-entry";
export type { MinimalAppOptions } from "boot/ts/frontend-entry";
export { default as crxFrontend, crxFrontend as mountCrxFrontend } from "boot/ts/crx-entry";
export type { CrxAppOptions } from "boot/ts/crx-entry";

export type { BootConfig, BootState, StyleSystem } from "boot/ts/BootLoader";
export type { AppLoaderResult, RoutingMode } from "boot/ts/routing";
export type { FrontendChoice } from "boot/ts/boot-menu";

export type ExecutionContext = "web" | "pwa" | "extension";

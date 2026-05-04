/**
 * Core Module
 *
 * Central module providing core utilities for the CrossWord application.
 *
 * Structure (PWA `dist/core/` chunks group by first directory; api/time/text/phone/workers fold into `main`):
 * - api/      : API client and service communication
 * - storage/  : localStorage, sessionStorage, IndexedDB, OPFS helpers, FS utilities
 * - document/ : Markdown rendering, DOCX export, document tools
 * - time/     : Time/date utilities
 * - text/     : Text formatting utilities
 * - phone/    : Phone number utilities
 * - workers/  : Worker-facing helpers (bundled with main chunk for deploy)
 * - modules/  : Feature modules (clipboard, history, etc.)
 * - utils/    : General utilities (types, theme, etc.)
 *
 * OPFS uniform worker script is emitted under `dist/workers/opfs/` (see fest/lure OPFS bridge).
 */

export * from "./other/utils";
export * from "../types";
export * from "../registry";
export * from "./routing/api/channel-actions";
export * from "./routing/core/registry";
export * from "./routing/core/channel-mixin";
export * from "./routing/core/view-message-routing";

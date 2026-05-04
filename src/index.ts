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

// ============================================================================
// API
// ============================================================================

export {
    api,
    API_PATHS,
    fetchWithTimeout,
    fetchWithRetry,
    type ApiResponse,
    type ProcessingOptions,
    type AnalyzeOptions,
    type ApiPath
} from "./api";

export {
    // Constants
    PHONE_CANDIDATE_RE,
    EXT_CUT_RE,

    // Normalization
    normalizeOne,
    splitCandidates,
    normalizePhones,

    // Row helpers
    getIndexForRow,
    getPhonesFromRow,

    // Duplicate detection
    findDuplicatePhones,

    // Types
    type NormalizeOptions,
    type DuplicateResult
} from "fest/core";

// ============================================================================
// DOCUMENT (Markdown & DOCX)
// ============================================================================

export {
    // Markdown
    renderMarkdown,
    renderMarkdownToElement,
    renderMarkdownSync,
    extractTitle,
    isLikelyMarkdown,
    type RenderOptions,
    type MarkdownResult,

    // DOCX
    downloadMarkdownAsDocx,
    downloadHtmlAsDocx,
    createDocxBlobFromHtml,
    createDocxBlobFromMarkdown,
    type DocxExportOptions,

    // Conversion
    convertToHtml,
    convertToMarkdown,
    copyAsMarkdown,
    copyAsHTML,
    copyAsTeX,
    copyAsMathML,
    type CopyOptions,

    // Parsing
    parseMarkdownEntry,
    unique,
    normalizeCollections,
    ensureCollections
} from "./document";

// ============================================================================
// CLIPBOARD
// ============================================================================

export {
    copy,
    writeText,
    writeHTML,
    writeImage,
    readText,
    toText,
    requestCopy,
    listenForClipboardRequests,
    initClipboardReceiver,
    requestCopyViaCRX,
    isChromeExtension,
    isClipboardAvailable,
    isClipboardWriteAvailable,
    COPY_HACK,
    copyWithResult,
    type ClipboardDataType,
    type ClipboardWriteOptions,
    type ClipboardResult,
    type CRXCopyOptions
} from "../../lur.e/src/interactive/modules/Clipboard";

// ============================================================================
// FILE UTILITIES
// ============================================================================

export {
    // Type detection
    isMarkdownFile,
    isTextFile,
    isImageFile,
    isCodeFile,

    // Reading
    readFileAsText,
    readFileAsDataURL,
    readFileAsArrayBuffer,

    // Creation
    createTextFile,
    createMarkdownFile,
    createJsonFile,

    // Download
    downloadFile,
    downloadTextFile,
    downloadMarkdown,

    // Picking
    pickFile,
    pickFiles,
    pickMarkdownFile,

    // File System Access API
    saveFile,
    openFile
} from "fest/lure";

// ============================================================================
// MODULES (Feature modules)
// ============================================================================

// ============================================================================
// GENERAL UTILITIES
// ============================================================================

export * from "./utils";

// ============================================================================
// COMMON HELPER FUNCTIONS
// ============================================================================

/**
 * Create a debounced function
 */
export function debounce<T extends (...args: any[]) => any>(
    fn: T,
    delay: number
): (...args: Parameters<T>) => void {
    let timeoutId: ReturnType<typeof setTimeout>;
    return (...args: Parameters<T>) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delay);
    };
}

/**
 * Create a throttled function
 */
export function throttle<T extends (...args: any[]) => any>(
    fn: T,
    limit: number
): (...args: Parameters<T>) => void {
    let inThrottle = false;
    return (...args: Parameters<T>) => {
        if (!inThrottle) {
            fn(...args);
            inThrottle = true;
            setTimeout(() => (inThrottle = false), limit);
        }
    };
}

/**
 * Wait for a specific duration
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate a unique ID
 */
export function uniqueId(prefix = ""): string {
    return `${prefix}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== "object") return obj;
    if (obj instanceof Date) return new Date(obj.getTime()) as T;
    if (obj instanceof Array) return obj.map(item => deepClone(item)) as T;
    if (obj instanceof Object) {
        const cloned = {} as T;
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                (cloned as any)[key] = deepClone((obj as any)[key]);
            }
        }
        return cloned;
    }
    return obj;
}

/**
 * Check if value is empty (null, undefined, empty string, empty array/object)
 */
export function isEmpty(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === "string") return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "object") return Object.keys(value).length === 0;
    return false;
}

/**
 * Clamp a number between min and max
 */
export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

/**
 * Check if we're in a browser environment
 */
export function isBrowser(): boolean {
    return typeof window !== "undefined" && typeof document !== "undefined";
}

/**
 * Check if we're in a worker environment
 */
export function isWorker(): boolean {
    return typeof self !== "undefined" && typeof window === "undefined";
}

/**
 * CrossWord Shared Frontend Module
 *
 * Split layout:
 * - `shell-bridge/` — registries, routing, channels, layers (shell ↔ view glue)
 * - `ui/` — toasts, menus, items/cards, canvas helpers
 * - `policies/` — DOM/event timing guards
 *
 * Root `*.ts` files re-export for stable `frontend/shared/<Name>` imports.
 *
 * @module frontend/shared
 */

export * from "./routing/registry";
export * from "./routing/channel-mixin";
export * from "./routing/view-message-routing";

export {
    initializeLayers,
    resetLayers,
    getShellLayer,
    getViewLayer,
    getLayerOrder,
    getLayersByCategory,
    areLayersInitialized,
    getLayerElement,
    LAYERS,
    LAYER_HIERARCHY,
    type LayerCategory,
    type LayerDefinition,
    type LayerName,
    type ShellId,
    type ViewId,
} from "./routing/layer-manager";

export { default as LayerManager } from "./routing/layer-manager";

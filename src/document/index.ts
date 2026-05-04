/**
 * Document Module
 *
 * Document processing utilities including:
 * - Markdown rendering
 * - DOCX export
 * - HTML/Markdown conversion
 * - Document tools
 */

// ============================================================================
// MARKDOWN RENDERING
// ============================================================================

export * from "./markdown";

// ============================================================================
// DOCX EXPORT
// ============================================================================

export {
    downloadMarkdownAsDocx,
    downloadHtmlAsDocx,
    createDocxBlobFromHtml,
    createDocxBlobFromMarkdown,
    type DocxExportOptions
} from "./DocxExport";

// ============================================================================
// HTML/MARKDOWN CONVERSION
// ============================================================================

export {
    convertToHtml,
    convertToMarkdown,
    copyAsMarkdown,
    copyAsHTML,
    copyAsTeX,
    copyAsMathML,
    type CopyOptions
} from "./Conversion";

// ============================================================================
// DOCUMENT TOOLS
// ============================================================================

export * from "./DocTools";

// ============================================================================
// DOCUMENT PARSING
// ============================================================================

export {
    parseMarkdownEntry,
    unique,
    normalizeCollections,
    ensureCollections
} from "./Parser";

// ============================================================================
// AI RESPONSE PARSING
// ============================================================================

export * from "./AIResponseParser";

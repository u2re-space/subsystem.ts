/**
 * Unified AI Configuration and Instructions
 *
 * Centralizes all AI processing rules, instructions, and configurations
 * for consistent behavior across different entry points and modules.
 */

import type { RecognizeByInstructionsOptions } from '../service/service/ProcessingData';

import { getProcessingRules, type AIProcessingType, type ProcessingRule } from "./processingRules";

export type { AIProcessingType, ProcessingRule };
export { getProcessingRules };

// Core content types
export type ContentType =
    | 'file'
    | 'blob'
    | 'text'
    | 'markdown'
    | 'image'
    | 'url'
    | 'base64';

// Content contexts (where content comes from)
export type ContentContext =
    | 'share-target'
    | 'launch-queue'
    | 'paste'
    | 'drag-drop'
    | 'file-open'
    | 'url-open'
    | 'crx-snip'
    | 'api-upload'
    | 'initial-load'
    | 'broadcast';

// Content actions (what to do with the content)
export type ContentAction =
    | 'view'          // Display in appropriate viewer
    | 'edit'          // Open in editor
    | 'attach'        // Attach to work center
    | 'process'       // Process with AI
    | 'save'          // Save to explorer
    | 'print'         // Send to print
    | 'clipboard';    // Copy to clipboard

// Association override factors for content routing
export type AssociationOverrideFactor =
    | 'explicit-workcenter'
    | 'explicit-viewer'
    | 'explicit-explorer'
    | 'force-attachment'
    | 'force-processing'
    | 'bypass-default'
    | 'user-action';

// Unified Processing Configuration
export interface UnifiedProcessingConfig {
    processingUrl: string;
    contentAction: {
        onResult: string;
        onAccept: string;
        doProcess: string;
        openApp?: boolean;
    };
    supportedContentTypes?: string[];
    defaultOverrideFactors?: AssociationOverrideFactor[];
    associationOverrides?: Record<string, AssociationOverrideFactor[]>;
}

// Unified Processing Rules for different entry points
export const UNIFIED_PROCESSING_RULES: Record<string, UnifiedProcessingConfig> = {
    "share-target": {
        processingUrl: "/api/processing",
        contentAction: {
            onResult: "write-clipboard",
            onAccept: "attach-to-associated",
            doProcess: "instantly",
            openApp: true
        },
        supportedContentTypes: ["text", "markdown", "image", "url"],
        defaultOverrideFactors: [] // Use default associations
    },
    "launch-queue": {
        processingUrl: "/api/processing",
        contentAction: {
            onResult: "none",
            onAccept: "attach-to-associated",
            doProcess: "manually",
            openApp: true
        },
        supportedContentTypes: ["file", "blob", "text", "markdown", "image"],
        defaultOverrideFactors: [] // Use default associations
    },
    "crx-snip": {
        processingUrl: "/api/processing",
        contentAction: {
            onResult: "write-clipboard",
            onAccept: "attach-to-associated",
            doProcess: "instantly",
            openApp: false // Don't open PWA for background processing
        },
        supportedContentTypes: ["text", "image"],
        defaultOverrideFactors: ["force-processing"] // Force processing for CRX snips
    },
    "paste": {
        processingUrl: "/api/processing",
        contentAction: {
            onResult: "none",
            onAccept: "attach-to-associated",
            doProcess: "manually",
            openApp: false
        },
        supportedContentTypes: ["text", "markdown", "image"],
        defaultOverrideFactors: [],
        associationOverrides: {
            // When user explicitly pastes and wants to process, override defaults
            "text": ["user-action"],
            "markdown": ["user-action"]
        }
    },
    "drop": {
        processingUrl: "/api/processing",
        contentAction: {
            onResult: "none",
            onAccept: "attach-to-associated",
            doProcess: "manually",
            openApp: false
        },
        supportedContentTypes: ["file", "blob", "text", "markdown", "image"],
        defaultOverrideFactors: [],
        associationOverrides: {
            // When user drops files explicitly, treat as user action
            "file": ["user-action"],
            "blob": ["user-action"]
        }
    },
    "button-attach-workcenter": {
        processingUrl: "/api/processing",
        contentAction: {
            onResult: "none",
            onAccept: "attach-to-workcenter",
            doProcess: "manually",
            openApp: false
        },
        supportedContentTypes: ["text", "markdown", "image", "file"],
        defaultOverrideFactors: ["explicit-workcenter"], // Always override to workcenter
        associationOverrides: {
            // Explicit button clicks always go to workcenter
            "markdown": ["explicit-workcenter"], // Override default viewer association
            "text": ["explicit-workcenter"],     // Override default viewer association
            "image": ["explicit-workcenter"],    // Already goes to workcenter, but explicit
            "file": ["explicit-workcenter"]      // Override file-explorer association
        }
    }
};

// Backward compatibility - keep the old format
export const processingRules = Object.fromEntries(
    Object.entries(UNIFIED_PROCESSING_RULES).map(([key, config]) => [
        key,
        {
            processingUrl: config.processingUrl,
            contentAction: config.contentAction,
            ...(config.supportedContentTypes && { supportedContentTypes: config.supportedContentTypes })
        }
    ])
);

// Content Type Mappings
export const CONTENT_TYPE_MAPPINGS = {
    // File extensions to MIME types
    extensions: {
        '.md': 'text/markdown',
        '.markdown': 'text/markdown',
        '.txt': 'text/plain',
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.ts': 'application/typescript',
        '.json': 'application/json',
        '.xml': 'application/xml',
        '.csv': 'text/csv',
        '.pdf': 'application/pdf',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.webp': 'image/webp'
    },

    // MIME type to processing type mapping
    mimeToProcessing: {
        'text/markdown': 'general-processing',
        'text/plain': 'general-processing',
        'text/html': 'extract-css',
        'text/css': 'extract-css',
        'application/javascript': 'write-code',
        'application/typescript': 'write-code',
        'application/json': 'convert-data',
        'application/xml': 'convert-data',
        'text/csv': 'convert-data',
        'application/pdf': 'recognize-content',
        'image/png': 'recognize-content',
        'image/jpeg': 'recognize-content',
        'image/gif': 'recognize-content',
        'image/svg+xml': 'extract-css',
        'image/webp': 'recognize-content'
    } as Record<string, AIProcessingType>
};

// Processing Configuration
export interface ProcessingConfig {
    maxRetries: number;
    timeoutMs: number;
    enableCaching: boolean;
    enableStreaming: boolean;
    defaultLanguage: string;
    supportedLanguages: string[];
}

// Default processing configuration
export const DEFAULT_PROCESSING_CONFIG: ProcessingConfig = {
    maxRetries: 3,
    timeoutMs: 30000,
    enableCaching: true,
    enableStreaming: false,
    defaultLanguage: 'en',
    supportedLanguages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ja', 'ko']
};

// Utility Functions

/**
 * Get the appropriate processing rule for content type and operation
 */
export function getProcessingRule(
    contentType: string,
    requestedType?: AIProcessingType
): ProcessingRule | null {
    const rules = getProcessingRules();
    // If specific type requested, try to find it
    if (requestedType) {
        const rule = rules.find(r => r.type === requestedType);
        if (rule && (rule.supportedContentTypes.includes(contentType) || rule.supportedContentTypes.includes('*'))) {
            return rule;
        }
    }

    // Otherwise, find best match based on content type and priority
    const matchingRules = rules
        .filter(rule => rule.supportedContentTypes.includes(contentType) || rule.supportedContentTypes.includes('*'))
        .sort((a, b) => b.priority - a.priority);

    return matchingRules[0] || null;
}

/**
 * Get MIME type from file extension
 */
export function getMimeTypeFromExtension(filename: string): string {
    const extension = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    return CONTENT_TYPE_MAPPINGS?.extensions?.[extension as keyof typeof CONTENT_TYPE_MAPPINGS.extensions] || 'application/octet-stream';
}

/**
 * Get processing type from MIME type
 */
export function getProcessingTypeFromMime(mimeType: string): AIProcessingType {
    return CONTENT_TYPE_MAPPINGS.mimeToProcessing[mimeType] || 'general-processing';
}

/**
 * Get processing type from file
 */
export function getProcessingTypeFromFile(file: File): AIProcessingType {
    const mimeType = file.type || getMimeTypeFromExtension(file.name);
    return getProcessingTypeFromMime(mimeType);
}

/**
 * Create processing options with defaults
 */
export function createProcessingOptions(
    overrides: Partial<RecognizeByInstructionsOptions> = {}
): RecognizeByInstructionsOptions {
    // RecognizeByInstructionsOptions currently only supports instruction + verbosity/effort knobs.
    // Keep this helper for forward compatibility, but only return supported keys.
    return { ...overrides };
}

/**
 * Validate content for processing
 */
export function validateContentForProcessing(
    content: any,
    contentType: string
): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!content) {
        errors.push('Content is required');
    }

    if (!contentType) {
        errors.push('Content type is required');
    }

    // Type-specific validation
    switch (contentType) {
        case 'text':
        case 'markdown':
            if (typeof content !== 'string' || content.trim().length === 0) {
                errors.push('Text content must be a non-empty string');
            }
            break;
        case 'file':
            if (!(content instanceof File)) {
                errors.push('File content must be a File object');
            }
            break;
        case 'blob':
            if (!(content instanceof Blob)) {
                errors.push('Blob content must be a Blob object');
            }
            break;
        case 'base64':
            if (typeof content !== 'string' || !content.match(/^data:[^;]+;base64,/)) {
                errors.push('Base64 content must be a valid data URL');
            }
            break;
    }

    return {
        valid: errors.length === 0,
        errors
    };
}
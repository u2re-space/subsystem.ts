/**
 * API Module
 *
 * Provides API client and service communication utilities.
 * Used for backend API calls and processing requests.
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * API response wrapper
 */
export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    metadata?: Record<string, unknown>;
}

/**
 * Processing request options
 */
export interface ProcessingOptions {
    content: string | File | Blob;
    contentType: "text" | "file" | "blob" | "base64";
    processingType?: "solve-and-answer" | "write-code" | "extract-css" | "recognize-content";
    options?: Record<string, unknown>;
}

/**
 * Analyze request options
 */
export interface AnalyzeOptions {
    content: string;
    contentType?: string;
    options?: Record<string, unknown>;
}

// ============================================================================
// API ENDPOINTS
// ============================================================================

/**
 * API endpoint paths
 */
export const API_PATHS = {
    PROCESSING: "/api/processing",
    ANALYZE: "/api/analyze",
    HEALTH: "/api/health",
    TEST: "/api/test",
    ICONS: "/assets/icons",
    DUOTONE_ICONS: "/assets/icons/duotone",
    PHOSPHOR_ICONS: "/assets/icons/phosphor"
} as const;

export type ApiPath = typeof API_PATHS[keyof typeof API_PATHS];

// ============================================================================
// API CLIENT
// ============================================================================

/**
 * API client for frontend communication with backend services
 */
export const api = {
    /**
     * Send content for AI processing
     */
    async process(options: ProcessingOptions): Promise<ApiResponse> {
        try {
            const response = await fetch(API_PATHS.PROCESSING, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(options)
            });
            return response.json();
        } catch (error) {
            return { success: false, error: String(error) };
        }
    },

    /**
     * Analyze content (lighter processing)
     */
    async analyze(content: string, contentType = "text"): Promise<ApiResponse> {
        try {
            const response = await fetch(API_PATHS.ANALYZE, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content, contentType })
            });
            return response.json();
        } catch (error) {
            return { success: false, error: String(error) };
        }
    },

    /**
     * Health check
     */
    async health(): Promise<{ ok: boolean; timestamp?: number }> {
        try {
            const response = await fetch(API_PATHS.HEALTH);
            return response.json();
        } catch {
            return { ok: false };
        }
    },

    /**
     * Test API endpoint
     */
    async test(): Promise<ApiResponse> {
        try {
            const response = await fetch(API_PATHS.TEST);
            return response.json();
        } catch (error) {
            return { success: false, error: String(error) };
        }
    },

    /**
     * Generic GET request
     */
    async get<T>(path: string): Promise<ApiResponse<T>> {
        try {
            const response = await fetch(path);
            return response.json();
        } catch (error) {
            return { success: false, error: String(error) };
        }
    },

    /**
     * Generic POST request
     */
    async post<T>(path: string, data: unknown): Promise<ApiResponse<T>> {
        try {
            const response = await fetch(path, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data)
            });
            return response.json();
        } catch (error) {
            return { success: false, error: String(error) };
        }
    }
};

// ============================================================================
// FETCH UTILITIES
// ============================================================================

/**
 * Fetch with timeout
 */
export async function fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeoutMs = 30000
): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Retry fetch with exponential backoff
 */
export async function fetchWithRetry(
    url: string,
    options: RequestInit = {},
    maxRetries = 3,
    baseDelayMs = 1000
): Promise<Response> {
    let lastError: Error | undefined;

    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fetch(url, options);
        } catch (error) {
            lastError = error as Error;
            if (i < maxRetries - 1) {
                await new Promise(resolve =>
                    setTimeout(resolve, baseDelayMs * Math.pow(2, i))
                );
            }
        }
    }

    throw lastError || new Error("Fetch failed");
}

// Default export
export default api;

export type { ChannelInvokableView } from "./channel-invokable";
export {
    FileAttachmentApiAction,
    FileWorkspaceUseAction,
    ExplorerChannelAction,
    WorkcenterChannelAction,
    ViewerChannelAction,
    SettingsChannelAction,
    AirpadChannelAction,
    HomeChannelAction,
    HistoryChannelAction,
    EditorChannelAction
} from "./channel-actions";

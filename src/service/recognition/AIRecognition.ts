/**
 * Standalone AI Recognition Service
 * Works independently in: PWA, Chrome Extension, Service Worker, Web App
 * Provides unified interface for AI recognition operations
 */

import { CHANNEL_NAMES, postMessage, affected } from "../../../core/workers/Broadcast";
import { MAX_FILE_SIZE } from "../model/GPT-Responses";
import { stringToBlob } from "fest/lure";

export type RecognitionMode = "recognize" | "analyze";

export interface RecognitionRequest {
    type: RecognitionMode;
    data: RecognitionData;
    requestId?: string;
}

export interface RecognitionData {
    image?: string | Blob;
    text?: string;
    url?: string;
    files?: File[];
    metadata?: Record<string, unknown>;
}

export interface RecognitionResult {
    requestId?: string;
    ok: boolean;
    data?: unknown;
    text?: string;
    latex?: string;
    mathml?: string;
    error?: string;
    mode?: RecognitionMode;
    timestamp?: number;
}

export type RecognitionHandler = (request: RecognitionRequest) => Promise<RecognitionResult>;

// Registry of recognition handlers per mode
const handlers = new Map<RecognitionMode, RecognitionHandler>();

/**
 * Register a recognition handler for a specific mode
 */
export const registerHandler = (mode: RecognitionMode, handler: RecognitionHandler): void => {
    handlers.set(mode, handler);
};

/**
 * Unregister a recognition handler
 */
export const unregisterHandler = (mode: RecognitionMode): void => {
    handlers.delete(mode);
};

/**
 * Process a recognition request using registered handler
 */
export const processRecognition = async (request: RecognitionRequest): Promise<RecognitionResult> => {
    const handler = handlers.get(request.type);

    if (!handler) {
        return {
            requestId: request.requestId,
            ok: false,
            error: `No handler registered for mode: ${request.type}`,
            mode: request.type,
            timestamp: Date.now()
        };
    }

    try {
        const result = await handler(request);
        return {
            ...result,
            requestId: request.requestId,
            mode: request.type,
            timestamp: Date.now()
        };
    } catch (err) {
        return {
            requestId: request.requestId,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            mode: request.type,
            timestamp: Date.now()
        };
    }
};

/**
 * Request AI recognition via broadcast (for cross-context communication)
 */
export const requestRecognition = (
    mode: RecognitionMode,
    data: RecognitionData,
    requestId?: string
): string => {
    const id = requestId || `rec_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    postMessage(CHANNEL_NAMES.AI_RECOGNITION, {
        type: mode,
        data,
        requestId: id
    } as RecognitionRequest);

    return id;
};

/**
 * Listen for recognition requests and process them
 */
export const listenForRecognitionRequests = (): (() => void) => {
    return affected<RecognitionRequest>(CHANNEL_NAMES.AI_RECOGNITION, async (request) => {
        if (request.type === "recognize" || request.type === "analyze") {
            const result = await processRecognition(request);

            // Broadcast result back
            postMessage(CHANNEL_NAMES.AI_RECOGNITION, {
                type: "result",
                ...result
            });
        }
    });
};

/**
 * Listen for recognition results
 */
export const listenForRecognitionResults = (
    callback: (result: RecognitionResult) => void
): (() => void) => {
    return affected<RecognitionResult & { type?: string }>(CHANNEL_NAMES.AI_RECOGNITION, (data) => {
        if (data.type === "result" || data.ok !== undefined) {
            callback(data);
        }
    });
};

/**
 * Create a one-time recognition request with result promise
 */
export const recognize = (
    mode: RecognitionMode,
    data: RecognitionData,
    timeout = 30000
): Promise<RecognitionResult> => {
    return new Promise((resolve, reject) => {
        const requestId = requestRecognition(mode, data);
        let unaffected: (() => void) | null = null;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
            if (unaffected) unaffected();
            if (timeoutId) clearTimeout(timeoutId);
        };

        unaffected = listenForRecognitionResults((result) => {
            if (result.requestId === requestId) {
                cleanup();
                resolve(result);
            }
        });

        timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error(`Recognition timeout after ${timeout}ms`));
        }, timeout);
    });
};

/**
 * Initialize recognition service (for contexts that process requests)
 */
export const initRecognitionService = (): (() => void) => {
    return listenForRecognitionRequests();
};

/**
 * Convert image to base64 data URL with size validation and error handling
 */
export const imageToDataUrl = async (image: Blob | File): Promise<string> => {
    if (image.size > MAX_FILE_SIZE) {
        throw new Error(`Image too large: ${(image.size / 1024 / 1024).toFixed(1)}MB. Maximum allowed: ${(MAX_FILE_SIZE / 1024 / 1024).toFixed(1)}MB`);
    }

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
            } else {
                reject(new Error("Failed to convert image to data URL"));
            }
        };
        reader.onerror = () => {
            const error = reader.error;
            reject(new Error(`Failed to read image: ${error?.message || 'Unknown error'}`));
        };
        reader.readAsDataURL(image);
    });
};

/**
 * Convert base64 data URL to Blob
 */
export const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
    return await stringToBlob(dataUrl);
};

// Default export for convenience
export default {
    registerHandler,
    unregisterHandler,
    process: processRecognition,
    request: requestRecognition,
    recognize,
    listenRequests: listenForRecognitionRequests,
    listenResults: listenForRecognitionResults,
    init: initRecognitionService,
    imageToDataUrl,
    dataUrlToBlob
};

/**
 * Recognition History Storage
 * Stores and retrieves recognition/solution results for viewing history
 */

import { JSOX } from "jsox";

export const HISTORY_DB_NAME = 'recognition-history';
export const HISTORY_STORE = 'history';
export const HISTORY_DB_VERSION = 1;
export const MAX_HISTORY_ITEMS = 100;

export type RecognitionHistoryItem = {
    id?: number;
    type: 'recognize' | 'solve' | 'answer' | 'code' | 'css' | 'custom';
    label: string;
    input: string; // Text summary of input (truncated if too long)
    output: string; // The recognized/solved result
    timestamp: number;
    success: boolean;
    instructionLabel?: string; // Which custom instruction was used
    metadata?: Record<string, unknown>;
};

function idbOpen(): Promise<IDBDatabase> {
    return new Promise((res, rej) => {
        if (typeof indexedDB === "undefined") {
            rej(new Error("IndexedDB not available"));
            return;
        }
        const req = indexedDB.open(HISTORY_DB_NAME, HISTORY_DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(HISTORY_STORE)) {
                const store = db.createObjectStore(HISTORY_STORE, { keyPath: 'id', autoIncrement: true });
                store.createIndex('byTimestamp', 'timestamp', { unique: false });
                store.createIndex('byType', 'type', { unique: false });
            }
        };
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
    });
}

/**
 * Add a new history item
 */
export async function addHistoryItem(item: Omit<RecognitionHistoryItem, 'id'>): Promise<number> {
    const db = await idbOpen();
    try {
        return await new Promise<number>((res, rej) => {
            const tx = db.transaction(HISTORY_STORE, 'readwrite');
            const store = tx.objectStore(HISTORY_STORE);
            const req = store.add(item);
            req.onsuccess = () => res(req.result as number);
            req.onerror = () => rej(req.error);
        });
    } finally {
        db.close();
    }
}

/**
 * Get recent history items (newest first)
 */
export async function getHistory(limit = 50): Promise<RecognitionHistoryItem[]> {
    const db = await idbOpen();
    try {
        return await new Promise<RecognitionHistoryItem[]>((res, rej) => {
            const tx = db.transaction(HISTORY_STORE, 'readonly');
            const store = tx.objectStore(HISTORY_STORE);
            const idx = store.index('byTimestamp');
            const result: RecognitionHistoryItem[] = [];
            
            const curReq = idx.openCursor(null, 'prev'); // Newest first
            curReq.onerror = () => rej(curReq.error);
            curReq.onsuccess = () => {
                const cursor = curReq.result;
                if (!cursor || result.length >= limit) return res(result);
                result.push(cursor.value as RecognitionHistoryItem);
                cursor.continue();
            };
        });
    } finally {
        db.close();
    }
}

/**
 * Get history items by type
 */
export async function getHistoryByType(
    type: RecognitionHistoryItem['type'],
    limit = 50
): Promise<RecognitionHistoryItem[]> {
    const db = await idbOpen();
    try {
        return await new Promise<RecognitionHistoryItem[]>((res, rej) => {
            const tx = db.transaction(HISTORY_STORE, 'readonly');
            const store = tx.objectStore(HISTORY_STORE);
            const idx = store.index('byType');
            const range = IDBKeyRange.only(type);
            const result: RecognitionHistoryItem[] = [];
            
            const curReq = idx.openCursor(range, 'prev');
            curReq.onerror = () => rej(curReq.error);
            curReq.onsuccess = () => {
                const cursor = curReq.result;
                if (!cursor || result.length >= limit) return res(result);
                result.push(cursor.value as RecognitionHistoryItem);
                cursor.continue();
            };
        });
    } finally {
        db.close();
    }
}

/**
 * Get a single history item by ID
 */
export async function getHistoryItem(id: number): Promise<RecognitionHistoryItem | null> {
    const db = await idbOpen();
    try {
        return await new Promise<RecognitionHistoryItem | null>((res, rej) => {
            const tx = db.transaction(HISTORY_STORE, 'readonly');
            const store = tx.objectStore(HISTORY_STORE);
            const req = store.get(id);
            req.onsuccess = () => res(req.result as RecognitionHistoryItem | null);
            req.onerror = () => rej(req.error);
        });
    } finally {
        db.close();
    }
}

/**
 * Delete a history item
 */
export async function deleteHistoryItem(id: number): Promise<void> {
    const db = await idbOpen();
    try {
        return await new Promise<void>((res, rej) => {
            const tx = db.transaction(HISTORY_STORE, 'readwrite');
            const store = tx.objectStore(HISTORY_STORE);
            const req = store.delete(id);
            req.onsuccess = () => res();
            req.onerror = () => rej(req.error);
        });
    } finally {
        db.close();
    }
}

/**
 * Clear all history
 */
export async function clearHistory(): Promise<void> {
    const db = await idbOpen();
    try {
        return await new Promise<void>((res, rej) => {
            const tx = db.transaction(HISTORY_STORE, 'readwrite');
            const store = tx.objectStore(HISTORY_STORE);
            const req = store.clear();
            req.onsuccess = () => res();
            req.onerror = () => rej(req.error);
        });
    } finally {
        db.close();
    }
}

/**
 * Prune old history items (keep only the most recent MAX_HISTORY_ITEMS)
 */
export async function pruneHistory(): Promise<number> {
    const db = await idbOpen();
    try {
        return await new Promise<number>((res, rej) => {
            const tx = db.transaction(HISTORY_STORE, 'readwrite');
            const store = tx.objectStore(HISTORY_STORE);
            const idx = store.index('byTimestamp');
            
            // Count total items
            const countReq = store.count();
            countReq.onerror = () => rej(countReq.error);
            countReq.onsuccess = () => {
                const count = countReq.result;
                if (count <= MAX_HISTORY_ITEMS) {
                    return res(0);
                }
                
                const toDelete = count - MAX_HISTORY_ITEMS;
                let deleted = 0;
                
                // Delete oldest items first
                const curReq = idx.openCursor(null, 'next');
                curReq.onerror = () => rej(curReq.error);
                curReq.onsuccess = () => {
                    const cursor = curReq.result;
                    if (!cursor || deleted >= toDelete) return res(deleted);
                    cursor.delete();
                    deleted++;
                    cursor.continue();
                };
            };
        });
    } finally {
        db.close();
    }
}

/**
 * Get history count
 */
export async function getHistoryCount(): Promise<number> {
    const db = await idbOpen();
    try {
        return await new Promise<number>((res, rej) => {
            const tx = db.transaction(HISTORY_STORE, 'readonly');
            const store = tx.objectStore(HISTORY_STORE);
            const req = store.count();
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
    } finally {
        db.close();
    }
}

/**
 * Helper to truncate input for storage
 */
export function truncateInput(input: string, maxLength = 200): string {
    if (input.length <= maxLength) return input;
    return input.substring(0, maxLength) + '...';
}

/**
 * Helper to create a history label from type
 */
export function getTypeLabel(type: RecognitionHistoryItem['type']): string {
    const labels: Record<RecognitionHistoryItem['type'], string> = {
        recognize: 'Recognition',
        solve: 'Solution',
        answer: 'Answer',
        code: 'Code',
        css: 'CSS',
        custom: 'Custom'
    };
    return labels[type] || type;
}

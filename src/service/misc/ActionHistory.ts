/**
 * Persistent action/execution history for recognition and processing flows.
 *
 * This store tracks what input arrived from which source, which rule/action was
 * applied, and whether the execution eventually succeeded or failed.
 */
export interface ActionContext {
    source: 'workcenter' | 'share-target' | 'launch-queue' | 'chrome-extension' | 'service-worker';
    sessionId?: string;
    userAgent?: string;
    referrer?: string;
}

export interface RecognizedData {
    content: string;
    timestamp: number;
    source: 'files' | 'text' | 'url' | 'markdown' | 'image' | 'mixed';
    recognizedAs: 'markdown' | 'html' | 'text' | 'json' | 'xml' | 'other'; // Format recognized as
    metadata?: Record<string, any>;
    responseId?: string; // GPT/AI response ID from HTTP level
}

export interface ProcessedData {
    content: string;
    timestamp: number;
    action: string; // Template/action applied
    sourceData: RecognizedData; // Reference to recognized data that was processed
    metadata?: Record<string, any>;
    responseId?: string; // GPT/AI response ID from HTTP level
}

export interface ActionInput {
    type: 'files' | 'text' | 'url' | 'markdown' | 'image' | 'mixed' | 'arrayBuffer' | 'process' | 'capture' | 'recognize';
    mode?: 'recognize' | 'solve' | 'answer' | 'code' | 'css' | 'custom' | 'image';
    files?: (File[] | Blob[]) | (File|Blob)[];
    text?: string;
    data?: any;
    url?: string;
    error?: string;
    content?: string | ArrayBuffer;
    contentType?: string;
    customInstructionId?: string;
    recognizedData?: RecognizedData; // New: structured recognized data
    processedData?: ProcessedData[]; // New: chain of processed data
    recognizedContent?: string; // Legacy: keep for backward compatibility
    metadata?: Record<string, any>;
}

export interface ActionResult {
    type: 'markdown' | 'json' | 'text' | 'html' | 'error' | 'arrayBuffer' | 'process';
    content: string;
    text?: string;
    arrayBuffer?: ArrayBuffer;
    process?: string;
    error?: string;
    processingTime?: number;
    tokenUsage?: number;
    model?: string;
    autoCopied?: boolean;
    responseId?: string; // GPT/AI response ID from HTTP level
    dataCategory?: 'recognized' | 'processed'; // Whether this is raw recognition or processed result
    processingChain?: ProcessedData[]; // Chain of processing steps if applicable
}

export interface ActionEntry {
    id: string;
    timestamp: number;
    context: ActionContext;
    action: string; // 'recognize', 'analyze', 'solve', 'generate', etc.
    input: ActionInput;
    result?: ActionResult;
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
    error?: string;
    ruleSet?: string; // Which rule set was applied
    executionId?: string; // Links to execution core
    dataCategory?: 'recognized' | 'processed'; // Core-level data categorization
    parentActionId?: string; // Links to parent recognized action for processed entries
}

export interface ActionHistoryState {
    entries: ActionEntry[];
    maxEntries: number;
    autoSave: boolean;
    filters: {
        source?: ActionContext['source'];
        action?: string;
        status?: ActionEntry['status'];
        dateRange?: { start: number; end: number };
    };
}

/** In-memory history store with optional browser persistence and lightweight filtering. */
export class ActionHistoryStore {
    private state: ActionHistoryState;
    private storageKey = 'rs-action-history';

    constructor(maxEntries: number = 500, autoSave: boolean = true) {
        this.state = {
            entries: [],
            maxEntries,
            autoSave,
            filters: {}
        };

        this.loadHistory();
    }

    /** Insert a new entry at the front of the timeline and enforce the retention limit. */
    addEntry(entry: Omit<ActionEntry, 'id' | 'timestamp'>): ActionEntry {
        const fullEntry: ActionEntry = {
            ...entry,
            id: this.generateId(),
            timestamp: Date.now()
        };

        this.state.entries.unshift(fullEntry);

        // Maintain max entries limit
        if (this.state.entries.length > this.state.maxEntries) {
            this.state.entries = this.state.entries.slice(0, this.state.maxEntries);
        }

        return fullEntry;
    }

    /**
     * Update an existing entry
     */
    updateEntry(id: string, updates: Partial<ActionEntry>): boolean {
        const index = this.state.entries.findIndex(entry => entry.id === id);
        if (index === -1) return false;

        Object.assign(this.state.entries[index], updates);
        return true;
    }

    /**
     * Get entry by ID
     */
    getEntry(id: string): ActionEntry | undefined {
        return this.state.entries.find(entry => entry.id === id);
    }

    /** Return entries matching the supplied filters without mutating store state. */
    getEntries(filters?: Partial<ActionHistoryState['filters']>): ActionEntry[] {
        let entries = [...this.state.entries];

        if (filters?.source) {
            entries = entries.filter(entry => entry.context.source === filters.source);
        }

        if (filters?.action) {
            entries = entries.filter(entry => entry.action === filters.action);
        }

        if (filters?.status) {
            entries = entries.filter(entry => entry.status === filters.status);
        }

        if (filters?.dateRange) {
            entries = entries.filter(entry =>
                entry.timestamp >= filters.dateRange!.start &&
                entry.timestamp <= filters.dateRange!.end
            );
        }

        return entries;
    }

    /**
     * Get recent entries
     */
    getRecentEntries(limit: number = 50): ActionEntry[] {
        return this.state.entries.slice(0, limit);
    }

    /**
     * Remove entry
     */
    removeEntry(id: string): boolean {
        const index = this.state.entries.findIndex(entry => entry.id === id);
        if (index === -1) return false;

        this.state.entries.splice(index, 1);
        return true;
    }

    /**
     * Clear all entries
     */
    clearEntries(): void {
        this.state.entries = [];
    }

    /**
     * Set filters
     */
    setFilters(filters: Partial<ActionHistoryState['filters']>): void {
        Object.assign(this.state.filters, filters);
    }

    /** Summarize history health and distribution by source/action. */
    getStats() {
        const entries = this.state.entries;
        const total = entries.length;
        const completed = entries.filter(e => e.status === 'completed').length;
        const failed = entries.filter(e => e.status === 'failed').length;
        const pending = entries.filter(e => e.status === 'pending' || e.status === 'processing').length;

        const bySource = entries.reduce((acc, entry) => {
            acc[entry.context.source] = (acc[entry.context.source] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const byAction = entries.reduce((acc, entry) => {
            acc[entry.action] = (acc[entry.action] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        return {
            total,
            completed,
            failed,
            pending,
            successRate: total > 0 ? (completed / total) * 100 : 0,
            bySource,
            byAction
        };
    }

    /**
     * Export entries
     */
    exportEntries(format: 'json' | 'csv' = 'json', filters?: Partial<ActionHistoryState['filters']>): string {
        const entries = this.getEntries(filters);

        if (format === 'csv') {
            const headers = ['ID', 'Timestamp', 'Source', 'Action', 'Status', 'Input Type', 'Result Type', 'Processing Time'];
            const rows = entries.map(entry => [
                entry.id,
                new Date(entry.timestamp).toISOString(),
                entry.context.source,
                entry.action,
                entry.status,
                entry.input.type,
                entry.result?.type || '',
                entry.result?.processingTime || ''
            ]);

            return [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
        }

        return JSON.stringify(entries, null, 2);
    }

    /**
     * Import entries
     */
    importEntries(data: string, format: 'json' | 'csv' = 'json'): number {
        let entries: ActionEntry[] = [];

        if (format === 'json') {
            try {
                entries = JSON.parse(data);
            } catch (e) {
                throw new Error('Invalid JSON format');
            }
        } else {
            // CSV parsing would be implemented here
            throw new Error('CSV import not implemented yet');
        }

        // Validate entries
        const validEntries = entries.filter(entry =>
            entry.id && entry.timestamp && entry.context && entry.action
        );

        // Add valid entries
        validEntries.forEach(entry => {
            if (!this.getEntry(entry.id)) {
                this.state.entries.push(entry);
            }
        });

        // Sort by timestamp (newest first)
        this.state.entries.sort((a, b) => b.timestamp - a.timestamp);

        // Maintain max entries limit
        if (this.state.entries.length > this.state.maxEntries) {
            this.state.entries = this.state.entries.slice(0, this.state.maxEntries);
        }

        this.saveHistory();
        return validEntries.length;
    }

    private generateId(): string {
        return `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private loadHistory(): void {
        try {
            if (typeof localStorage === "undefined") return;
            const stored = localStorage.getItem(this.storageKey);
            if (stored) {
                const data = JSON.parse(stored);
                if (Array.isArray(data)) {
                    this.state.entries = data.map(entry => ({
                        ...entry,
                        // Ensure backward compatibility
                        context: entry.context || { source: 'unknown' },
                        input: entry.input || { type: 'unknown' },
                        status: entry.status || 'completed'
                    }));
                }
            }
        } catch (e) {
            console.warn('Failed to load action history:', e);
            this.state.entries = [];
        }
    }

    private saveHistory(): void {
        if (!this.state.autoSave) return;

        try {
            if (typeof localStorage === "undefined") return;
            localStorage.setItem(this.storageKey, JSON.stringify(this.state.entries));
        } catch (e) {
            console.warn('Failed to save action history:', e);
        }
    }
}

// Singleton instance
export const actionHistory = new ActionHistoryStore();
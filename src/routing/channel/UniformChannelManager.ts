/**
 * Uniform Channel Manager for CrossWord
 * Re-exports fest/uniform channel management with app-specific configuration
 */

import {
    createQueuedOptimizedWorkerChannel,
    OptimizedWorkerChannel,
    detectExecutionContext,
    supportsDedicatedWorkers
} from 'fest/uniform';

import { globalChannelRegistry, globalChannelHealthMonitor, createDeferred } from 'fest/core';

// Re-export types and functions from fest/uniform
export { OptimizedWorkerChannel, detectExecutionContext, supportsDedicatedWorkers };

// ============================================================================
// TYPES
// ============================================================================

export interface ViewChannelConfig {
    viewHash: string;
    workerConfigs: WorkerConfig[];
    autoStart?: boolean;
}

export interface WorkerConfig {
    name: string;
    script: string | (() => Worker) | Worker;
    options?: WorkerOptions;
    protocolOptions?: {
        timeout?: number;
        retries?: number;
        batching?: boolean;
        compression?: boolean;
    };
}

// ============================================================================
// UNIFORM CHANNEL MANAGER
// ============================================================================

export class UniformChannelManager {
    private static instance: UniformChannelManager;
    private channels = new Map<string, OptimizedWorkerChannel>();
    private viewChannels = new Map<string, Set<string>>();
    private initializedViews = new Set<string>();
    private viewReadyPromises = new Map<string, ReturnType<typeof createDeferred>>();
    private executionContext: ReturnType<typeof detectExecutionContext>;

    constructor() {
        this.executionContext = detectExecutionContext();
    }

    static getInstance(): UniformChannelManager {
        if (!UniformChannelManager.instance) {
            UniformChannelManager.instance = new UniformChannelManager();
        }
        return UniformChannelManager.instance;
    }

    /**
     * Register channels for a specific view
     */
    registerViewChannels(viewHash: string, configs: WorkerConfig[]): void {
        const channelNames = new Set<string>();

        for (const config of configs) {
            if (!this.isWorkerSupported(config)) {
                console.log(`[UniformChannelManager] Skipping worker '${config.name}' in ${this.executionContext} context`);
                continue;
            }

            const channel = createQueuedOptimizedWorkerChannel({
                name: config.name,
                script: config.script,
                options: config.options,
                context: this.executionContext
            }, config.protocolOptions, () => {
                console.log(`[UniformChannelManager] Channel '${config.name}' ready for view '${viewHash}' in ${this.executionContext} context`);
            });

            this.channels.set(`${viewHash}:${config.name}`, channel);
            channelNames.add(config.name);
        }

        this.viewChannels.set(viewHash, channelNames);
    }

    private isWorkerSupported(_config: WorkerConfig): boolean {
        if (this.executionContext === 'service-worker') {
            return true;
        }
        if (this.executionContext === 'chrome-extension') {
            return supportsDedicatedWorkers();
        }
        return true;
    }

    /**
     * Initialize channels when a view becomes active
     */
    async initializeViewChannels(viewHash: string): Promise<void> {
        if (this.initializedViews.has(viewHash)) return;

        const deferred = createDeferred<void>();
        this.viewReadyPromises.set(viewHash, deferred);

        console.log(`[UniformChannelManager] Initializing channels for view: ${viewHash}`);

        const channelNames = this.viewChannels.get(viewHash);
        if (!channelNames) {
            deferred.resolve();
            return;
        }

        const initPromises: Promise<void>[] = [];

        for (const channelName of channelNames) {
            const channelKey = `${viewHash}:${channelName}`;
            const channel = this.channels.get(channelKey);

            if (channel) {
                globalChannelRegistry.register(channelKey, channel);
                globalChannelHealthMonitor.registerHealthCheck(
                    channelKey,
                    async () => {
                        try {
                            await channel.request('ping', {});
                            return true;
                        } catch {
                            return false;
                        }
                    },
                    30000
                );

                initPromises.push(
                    channel.request('ping', {}).catch(() => {
                        console.log(`[UniformChannelManager] Channel '${channelName}' queued for view '${viewHash}'`);
                    })
                );
            }
        }

        await Promise.allSettled(initPromises);
        this.initializedViews.add(viewHash);
        deferred.resolve();
    }

    /**
     * Get a channel for a specific view and worker
     */
    getChannel(viewHash: string, workerName: string): OptimizedWorkerChannel | null {
        return this.channels.get(`${viewHash}:${workerName}`) ?? null;
    }

    /**
     * Get all channels for a view
     */
    getViewChannels(viewHash: string): OptimizedWorkerChannel[] {
        const channelNames = this.viewChannels.get(viewHash);
        if (!channelNames) return [];

        return Array.from(channelNames)
            .map(name => this.channels.get(`${viewHash}:${name}`))
            .filter((channel): channel is OptimizedWorkerChannel => channel != null);
    }

    /**
     * Close all channels for a view
     */
    closeViewChannels(viewHash: string): void {
        const channels = this.getViewChannels(viewHash);
        for (const channel of channels) {
            channel.close();
        }

        const channelNames = this.viewChannels.get(viewHash);
        if (channelNames) {
            for (const name of channelNames) {
                this.channels.delete(`${viewHash}:${name}`);
            }
        }

        this.viewChannels.delete(viewHash);
        this.initializedViews.delete(viewHash);
    }

    /**
     * Wait for a view's channels to be ready
     */
    async waitForViewChannels(viewHash: string): Promise<void> {
        const deferred = this.viewReadyPromises.get(viewHash);
        if (deferred) {
            await deferred.promise;
        } else if (!this.initializedViews.has(viewHash)) {
            await this.initializeViewChannels(viewHash);
        }
    }

    /**
     * Check if a view's channels are ready
     */
    isViewReady(viewHash: string): boolean {
        return this.initializedViews.has(viewHash);
    }

    /**
     * Get channel status for debugging
     */
    getStatus() {
        const status: Record<string, unknown> = {};
        const healthStatuses = globalChannelHealthMonitor.getAllHealthStatuses();

        for (const [key, channel] of this.channels) {
            status[key] = {
                queueStatus: (channel as unknown as { getQueueStatus?: () => unknown }).getQueueStatus?.() ?? 'unknown',
                healthy: healthStatuses[key] ?? 'unknown'
            };
        }

        return {
            totalChannels: this.channels.size,
            initializedViews: Array.from(this.initializedViews),
            registryChannels: globalChannelRegistry.getChannelNames(),
            healthStatuses,
            channels: status
        };
    }
}

// ============================================================================
// CONVENIENCE EXPORTS
// ============================================================================

/**
 * Pre-configured view channel registrations
 */
export const initializeAppChannels = (): void => {
    const _manager = UniformChannelManager.getInstance();
    // Add app-specific channel registrations here if needed
};

/**
 * Export singleton instance
 */
export const channelManager = UniformChannelManager.getInstance();

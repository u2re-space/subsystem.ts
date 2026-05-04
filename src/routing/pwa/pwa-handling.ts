// ============================================================================
// SERVICE WORKER AND ASSET UPDATE HANDLING
// ============================================================================

import { ensureServiceWorkerRegistered } from "./sw-url";

const IS_DEV = Boolean((import.meta as any)?.env?.DEV);
const AUTO_RELOAD_COOLDOWN_MS = 2 * 60 * 1000;
const RELOAD_GUARD_KEY = "cw:pwa:last-auto-reload-at";

const shouldSkipAutoReloadNow = (): boolean => {
    if (IS_DEV) return true;
    try {
        const now = Date.now();
        const last = Number(globalThis?.sessionStorage?.getItem?.(RELOAD_GUARD_KEY) || "0");
        if (Number.isFinite(last) && now - last < AUTO_RELOAD_COOLDOWN_MS) {
            return true;
        }
        globalThis?.sessionStorage?.setItem?.(RELOAD_GUARD_KEY, String(now));
    } catch {
        // ignore storage errors and continue
    }
    return false;
};

// Utility function to check if running as Chrome extension
const isExtension = () => {
    try {
        return (
            typeof chrome !== "undefined" &&
            Boolean((chrome as any)?.runtime?.id) &&
            globalThis?.location?.protocol === "chrome-extension:"
        );
    } catch {
        return false;
    }
};

const isCapacitorNative = (): boolean => {
    try {
        const c = (globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
        return typeof c?.isNativePlatform === "function" && Boolean(c.isNativePlatform());
    } catch {
        return false;
    }
};

const isServiceWorkerAllowedContext = () => {
    const protocol = (globalThis?.location?.protocol || "").toLowerCase();
    if (protocol === "chrome-extension:" || protocol === "file:" || protocol === "about:") return false;
    if (protocol === "capacitor:" || protocol === "ionic:") return true;
    if (isCapacitorNative() && (protocol === "https:" || protocol === "http:")) return true;
    return protocol === "https:" || protocol === "http:";
};

// ============================================================================
// ASSET UPDATE SYSTEM
// ============================================================================

/**
 * Asset cache versioning and update detection
 */
class AssetUpdateManager {
    private static instance: AssetUpdateManager;
    private assetVersions: Map<string, string> = new Map();
    private updateCheckInterval: number | null = null;
    private isChecking = false;

    static getInstance(): AssetUpdateManager {
        if (!AssetUpdateManager.instance) {
            AssetUpdateManager.instance = new AssetUpdateManager();
        }
        return AssetUpdateManager.instance;
    }

    /**
     * Check if an asset has been updated by comparing versions
     */
    async checkAssetUpdate(url: string, currentVersion?: string): Promise<boolean> {
        try {
            const response = await fetch(url, {
                method: 'HEAD',
                cache: 'no-cache',
                headers: {
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });

            if (!response.ok) return false;

            // Check various version indicators
            const etag = response.headers.get('etag');
            const lastModified = response.headers.get('last-modified');
            const contentLength = response.headers.get('content-length');

            // Create a version hash from available headers
            const versionKey = `${etag || ''}-${lastModified || ''}-${contentLength || ''}`;
            const storedVersion = this.assetVersions.get(url);

            if (storedVersion && storedVersion !== versionKey) {
                console.log(`[AssetUpdate] Asset updated: ${url}`);
                this.assetVersions.set(url, versionKey);
                return true;
            }

            this.assetVersions.set(url, versionKey);
            return false;
        } catch (error) {
            console.warn(`[AssetUpdate] Failed to check asset: ${url}`, error);
            return false;
        }
    }

    /**
     * Force refresh a cached asset by adding cache-busting parameter
     */
    forceRefreshAsset(url: string): string {
        const separator = url.includes('?') ? '&' : '?';
        const timestamp = Date.now();
        return `${url}${separator}_cache=${timestamp}`;
    }

    /**
     * Check all critical assets for updates
     */
    async checkAllAssets(): Promise<string[]> {
        if (this.isChecking) return [];
        this.isChecking = true;

        const criticalAssets = IS_DEV
            ? [] // Dev server + injectManifest can cause noisy update signals.
            : [
                './choice.js',
                './favicon.svg',
                './favicon.png'
            ];

        const updatedAssets: string[] = [];

        try {
            const checks = criticalAssets.map(async (asset) => {
                const isUpdated = await this.checkAssetUpdate(asset);
                if (isUpdated) {
                    updatedAssets.push(asset);
                }
            });

            await Promise.all(checks);
        } finally {
            this.isChecking = false;
        }

        return updatedAssets;
    }

    /**
     * Start periodic asset checking
     */
    startPeriodicChecks(intervalMs = 5 * 60 * 1000): void { // 5 minutes default
        if (this.updateCheckInterval) {
            globalThis?.clearInterval?.(this.updateCheckInterval);
        }

        this.updateCheckInterval = globalThis?.setInterval?.(async () => {
            const updatedAssets = await this.checkAllAssets();
            if (updatedAssets.length > 0) {
                console.log('[AssetUpdate] Updated assets detected:', updatedAssets);
                globalThis?.dispatchEvent?.(new CustomEvent('assets-updated', {
                    detail: { updatedAssets }
                }));
            }
        }, intervalMs) as unknown as number | null;
    }

    /**
     * Stop periodic checking
     */
    stopPeriodicChecks(): void {
        if (this.updateCheckInterval) {
            clearInterval(this.updateCheckInterval);
            this.updateCheckInterval = null;
        }
    }
}

/**
 * Show reload notification for critical updates
 */
function showReloadNotification(): void {
    // Remove any existing notification
    const existing = document.querySelector('.app-reload-notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.className = 'app-reload-notification';
    Object.assign(notification.style, {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        background: 'rgba(0, 0, 0, 0.9)',
        color: 'white',
        padding: '24px',
        borderRadius: '12px',
        zIndex: '10002',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        textAlign: 'center',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.1)'
    });

    notification.innerHTML = `
        <div style="font-size: 1.5rem; margin-bottom: 8px;"><ui-icon icon="arrow-clockwise" icon-style="duotone"></ui-icon></div>
        <div style="font-size: 1.1rem; font-weight: 600; margin-bottom: 8px;">Update Available</div>
        <div style="opacity: 0.8; margin-bottom: 16px;">CrossWord has been updated and will reload shortly.</div>
        <div style="font-size: 0.9rem; opacity: 0.6;">Reloading in 3 seconds...</div>
    `;

    document.body.appendChild(notification);

    // Auto-reload after 3 seconds
    let countdown = 3;
    const countdownInterval = setInterval(() => {
        countdown--;
        const countdownEl = notification.querySelector('div:last-child');
        if (countdownEl) {
            countdownEl.textContent = `Reloading in ${countdown} second${countdown !== 1 ? 's' : ''}...`;
        }
        if (countdown <= 0) {
            clearInterval(countdownInterval);
            globalThis?.location?.reload?.();
        }
    }, 1000);

    // Allow immediate reload on click
    notification.addEventListener('click', () => {
        clearInterval(countdownInterval);
        globalThis?.location?.reload?.();
    });
}


/**
 * Service worker update manager with enhanced features
 */
class ServiceWorkerUpdateManager {
    private registration: ServiceWorkerRegistration | null = null;
    private updateToast: HTMLElement | null = null;

    private async waitForController(timeoutMs = 4000): Promise<boolean> {
        if (navigator.serviceWorker.controller) return true;
        return await new Promise<boolean>((resolve) => {
            let done = false;
            const finish = (value: boolean) => {
                if (done) return;
                done = true;
                try { navigator.serviceWorker.removeEventListener('controllerchange', onChange); } catch {}
                clearTimeout(timer);
                resolve(value);
            };
            const onChange = () => finish(Boolean(navigator.serviceWorker.controller));
            const timer = setTimeout(() => finish(Boolean(navigator.serviceWorker.controller)), timeoutMs);
            navigator.serviceWorker.addEventListener('controllerchange', onChange, { once: true });
        });
    }

    async register(): Promise<ServiceWorkerRegistration | null> {
        if (!('serviceWorker' in navigator) || isExtension() || !isServiceWorkerAllowedContext()) {
            return null;
        }

        try {
            this.registration = await ensureServiceWorkerRegistered();
            if (!this.registration) {
                console.warn('[SW] Service worker registration skipped: no valid script candidate');
                return null;
            }
            this.setupUpdateListeners();
            this.startPeriodicUpdates();

            // Do not block PWA init on `ready` / controller: first install + precache can take a long
            // time; the app shell should paint while the SW finishes in the background.
            void navigator.serviceWorker.ready.catch(() => undefined);
            void this.waitForController(1500).catch(() => false);

            console.log('[SW] Service worker registered successfully');

            return this.registration;
        } catch (error) {
            console.error('[SW] Registration failed:', error);
            return null;
        }
    }

    private setupUpdateListeners(): void {
        if (!this.registration) return;

        // Listen for service worker updates
        this.registration.addEventListener('updatefound', () => {
            const newWorker = this.registration?.installing;
            if (!newWorker) return;

            console.log('[SW] New service worker found, installing...');

            newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed') {
                    if (navigator.serviceWorker.controller) {
                        // New version available
                        console.log('[SW] New service worker installed, ready to activate');
                        this.showUpdateNotification();
                    } else {
                        // First install
                        console.log('[SW] Service worker installed for offline use');
                    }
                } else if (newWorker.state === 'activated') {
                    console.log('[SW] New service worker activated');
                    globalThis?.dispatchEvent?.(new CustomEvent('sw-activated', {
                        detail: { registration: this.registration }
                    }));
                }
            });
        });

        // Handle controller change (new SW takes control)
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            console.log('[SW] Controller changed - new service worker active');
            globalThis?.dispatchEvent?.(new CustomEvent('sw-controller-changed'));
        });

        // Listen for messages from service worker
        navigator.serviceWorker.addEventListener('message', (event) => {
            const { type, data } = event.data || {};

            switch (type) {
                case 'sw-update-ready':
                    console.log('[SW] Service worker reports update ready');
                    this.showUpdateNotification();
                    break;

                case 'asset-updated':
                    console.log('[PWA] Service worker detected asset update:', data);
                    // Force reload for critical asset updates
                    if (data.url.includes('choice.js') || data.url.includes('sw.js')) {
                        showReloadNotification();
                    }
                    break;

                case 'sw-activated':
                    console.log('[PWA] Service worker activated');
                    break;

                case 'cache-status':
                    console.log('[PWA] Cache status:', data);
                    break;

                default:
                    console.log('[PWA] Unknown SW message:', type, data);
            }
        });
    }

    private startPeriodicUpdates(): void {
        const dev = Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
        if (dev) return;
        // Check for updates every 30 minutes
        globalThis?.setInterval?.(() => {
            this.registration?.update().catch(console.warn);
        }, 30 * 60 * 1000);
    }

    private showUpdateNotification(): void {
        // Remove existing notification
        this.hideUpdateNotification();

        // Create update notification
        this.updateToast = document.createElement('div');
        Object.assign(this.updateToast.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            background: '#007acc',
            color: 'white',
            padding: '16px 20px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            zIndex: '10000',
            fontFamily: 'system-ui, sans-serif',
            fontSize: '14px',
            cursor: 'pointer',
            maxWidth: '300px',
            transition: 'all 0.3s ease'
        });

        this.updateToast.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 4px;">Update Available</div>
            <div style="opacity: 0.9; margin-bottom: 12px;">A new version of CrossWord is ready</div>
            <div style="display: flex; gap: 8px;">
                <button id="update-now" style="
                    background: white;
                    color: #007acc;
                    border: none;
                    padding: 6px 12px;
                    border-radius: 4px;
                    font-size: 12px;
                    font-weight: 600;
                    cursor: pointer;
                ">Update Now</button>
                <button id="update-later" style="
                    background: transparent;
                    color: white;
                    border: 1px solid rgba(255,255,255,0.3);
                    padding: 6px 12px;
                    border-radius: 4px;
                    font-size: 12px;
                    cursor: pointer;
                ">Later</button>
            </div>
        `;

        // Add event listeners
        const updateNowBtn = this.updateToast.querySelector('#update-now');
        const updateLaterBtn = this.updateToast.querySelector('#update-later');

        updateNowBtn?.addEventListener('click', () => {
            this.applyUpdate();
        });

        updateLaterBtn?.addEventListener('click', () => {
            this.hideUpdateNotification();
        });

        // Auto-hide after 30 seconds
        setTimeout(() => {
            this.hideUpdateNotification();
        }, 30000);

        document.body.appendChild(this.updateToast);

        // Dispatch event for app components to handle
        globalThis?.dispatchEvent?.(new CustomEvent('sw-update-notification-shown'));
    }

    private hideUpdateNotification(): void {
        if (this.updateToast) {
            this.updateToast.style.opacity = '0';
            setTimeout(() => {
                this.updateToast?.remove();
                this.updateToast = null;
            }, 300);
        }
    }

    private async applyUpdate(): Promise<void> {
        console.log('[SW] Applying service worker update...');

        // Hide notification
        this.hideUpdateNotification();

        // Skip waiting and reload
        if (this.registration?.waiting) {
            this.registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        // Reload the page to activate new SW and clear caches
        globalThis?.location?.reload?.();
    }

    /**
     * Force check for service worker updates
     */
    async checkForUpdates(): Promise<void> {
        await this.registration?.update();
    }
}

/**
 * Initialize PWA features and asset update system
 */
export const initPWA = async () => {
    console.log('[PWA] Initializing PWA features...');

    try {
        // Check if we're running as a PWA
        const isStandalone = globalThis?.matchMedia?.('(display-mode: standalone)').matches ||
            (globalThis?.navigator as any)?.standalone === true;

        if (isStandalone) {
            console.log('[PWA] Running in standalone mode');
        }

        // Initialize asset update manager
        const assetManager = AssetUpdateManager.getInstance();
        assetManager.startPeriodicChecks();

        // Initialize service worker update manager
        const swManager = new ServiceWorkerUpdateManager();
        const registration = await swManager.register();

        // Listen for asset updates
        globalThis?.addEventListener?.('assets-updated', (event: any) => {
            const { updatedAssets } = event.detail;
            console.log('[PWA] Assets updated:', updatedAssets);

            // Force reload if critical assets were updated
            const criticalAssets = ['choice.js'];
            const criticalUpdated = updatedAssets.some((asset: string) =>
                criticalAssets.some(critical => asset.includes(critical))
            );

            if (criticalUpdated) {
                if (shouldSkipAutoReloadNow()) {
                    console.log('[PWA] Auto reload suppressed (dev or cooldown)');
                    return;
                }
                console.log('[PWA] Critical assets updated, reloading...');
                showReloadNotification();
            }
        });

        // Handle install prompt for PWA
        let deferredPrompt: any = null;
        globalThis?.addEventListener?.('beforeinstallprompt', (e) => {
            console.log('[PWA] Install prompt available');
            e.preventDefault();
            deferredPrompt = e;

            // Dispatch event for app to show install button
            globalThis?.dispatchEvent?.(new CustomEvent('pwa-install-available', {
                detail: { prompt: deferredPrompt }
            }));
        });

        // Handle successful installation
        globalThis?.addEventListener?.('appinstalled', () => {
            console.log('[PWA] App installed successfully');
            deferredPrompt = null;
        });

        return registration;
    } catch (error) {
        console.warn('[PWA] PWA initialization failed:', error);
    }

    //
    return null;
};

/**
 * Manually check for updates (can be called from app UI)
 */
export const checkForUpdates = async (): Promise<void> => {
    console.log('[PWA] Manual update check requested');

    try {
        // Check service worker for updates
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            const registration = await navigator.serviceWorker.getRegistration();
            if (registration) {
                console.log('[PWA] Checking service worker for updates...');
                await registration.update();

                // Send message to service worker to check for updates
                if (registration.active) {
                    registration.active.postMessage({ type: 'CHECK_FOR_UPDATES' });
                }
            }
        }

        // Check assets for updates
        const assetManager = AssetUpdateManager.getInstance();
        const updatedAssets = await assetManager.checkAllAssets();
        if (updatedAssets.length > 0) {
            console.log('[PWA] Asset updates found:', updatedAssets);
            globalThis?.dispatchEvent?.(new CustomEvent('assets-updated', {
                detail: { updatedAssets }
            }));
        } else {
            console.log('[PWA] No updates found');
            // Could dispatch an event to show "up to date" message
            globalThis?.dispatchEvent?.(new CustomEvent('app-up-to-date'));
        }
    } catch (error) {
        console.error('[PWA] Manual update check failed:', error);
        throw error;
    }
};

/**
 * Force reload all cached assets
 */
export const forceRefreshAssets = async (): Promise<void> => {
    console.log('[PWA] Force refreshing all cached assets');

    try {
        // Clear all caches
        const cacheNames = await caches.keys();
        await Promise.all(
            cacheNames.map(cacheName => caches.delete(cacheName))
        );
        console.log('[PWA] All caches cleared');

        // Reload the page to fetch fresh assets
        globalThis?.location?.reload?.();
    } catch (error) {
        console.error('[PWA] Failed to force refresh assets:', error);
        throw error;
    }
};
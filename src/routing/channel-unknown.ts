import { createFileHandler, getCachedComponent, getSpeechPrompt, H } from "fest/lure";
import { ensureStyleSheet } from "fest/icon";

// Import unified messaging system
import {
    unifiedMessaging,
    initializeComponent,
    hasPendingMessages,
    registerComponent,
    processInitialContent,
    enqueuePendingMessage
} from "com/core/UnifiedMessaging";
import { createMessageWithOverrides } from "com/core/UnifiedMessaging";
import type { ContentContext, ContentType } from "com/core/UnifiedAIConfig";

// Import file handling components that are always needed
import { createTemplateManager } from "core/modules/TemplateManager";
import { BROADCAST_CHANNELS, getBroadcastChannelForDestination } from "com/config/Names";
import { loadAsAdopted } from "fest/dom";
import { clearIconCaches, clearIconCache, testIconRacing, reinitializeRegistry, debugIconSystem } from "fest/icon";
import type { AppSettings } from "com/config/SettingsTypes";
import { loadSettings } from "com/config/Settings";
import { fetchSwCachedEntries } from "com/core/ShareTargetGateway";
// @ts-ignore - bundled as inline stylesheet
import style from "views/views.scss?inline";
import type { FileManager } from "views/explorer";



const CHANNELS = {
    SHARE_TARGET: BROADCAST_CHANNELS.SHARE_TARGET,
    TOAST: BROADCAST_CHANNELS.TOAST,
    CLIPBOARD: BROADCAST_CHANNELS.CLIPBOARD,
    MINIMAL_APP: BROADCAST_CHANNELS.MINIMAL_APP,
    MAIN_APP: BROADCAST_CHANNELS.MAIN_APP,
    FILE_EXPLORER: BROADCAST_CHANNELS.FILE_EXPLORER,
    PRINT_VIEWER: BROADCAST_CHANNELS.PRINT_VIEWER
} as const;

// ============================================================================
// UTILITY FUNCTIONS & HELPERS
// ============================================================================

/**
 * Safe localStorage operations with error handling
 */
const safeLocalStorage = {
    get: (key: string, defaultValue = "") => {
        try { return localStorage.getItem(key) || defaultValue; } catch { return defaultValue; }
    },
    set: (key: string, value: string) => {
        try { localStorage.setItem(key, value); } catch { /* ignore */ }
    }
};

// showStatusMessage will be defined inside mountMinimalApp to access state and renderStatus

/**
 * Unified component loading with error handling
 */
const loadComponent = async (componentName: string, importFn: () => Promise<any>, options: { componentName: string; cssPath?: string } = { componentName }) => {
    try {
        return await getCachedComponent(componentName, importFn, options);
    } catch (error) {
        console.error(`Failed to load ${componentName}:`, error);
        throw error;
    }
};

// Module-level variables that don't depend on state
let workCenterAttachmentInProgress = false;

export type ShellView = "markdown-viewer" | "markdown-editor" | "rich-editor" | "settings" | "history" | "workcenter" | "file-picker" | "file-explorer";

export type Destination = "viewer" | "markdown-editor" | "rich-editor" | "workcenter" | "explorer";

export type ShellOptions = {
    initialView?: ShellView;
    initialMarkdown?: string;
    /** PWA share-target / launchQueue can inject files to pre-attach in WorkCenter */
    initialFiles?: File[];
};

type HistoryEntry = {
    ts: number;
    prompt: string;
    before: string;
    after: string;
    ok: boolean;
    error?: string;
};

const HISTORY_KEY = "rs-history";
const LAST_SRC_KEY = "rs-last-src";
const DEFAULT_MD = "# CrossWord (Basic)\n\nOpen a markdown file or paste content here.\n";
const MARKDOWN_EXTENSION_PATTERN = /\.(?:md|markdown|mdown|mkd|mkdn|mdtxt|mdtext)(?:$|[?#])/i;

// Hash location mappings for views
const HASH_VIEW_MAPPING = {
    '#viewer': 'markdown-viewer',
    '#editor': 'markdown-editor',
    '#workcenter': 'workcenter',
    '#settings': 'settings',
    '#history': 'history',
    '#explorer': 'file-explorer',
    '#rich-editor': 'rich-editor',
    // Share-target specific routes - all redirect to workcenter
    '#share-target-text': 'workcenter',
    '#share-target-files': 'workcenter',
    '#share-target-url': 'workcenter',
    '#share-target-image': 'workcenter'
} as const;

const VIEW_HASH_MAPPING = {
    'markdown-viewer': '#viewer',
    'markdown-editor': '#editor',
    'workcenter': '#workcenter',
    'settings': '#settings',
    'history': '#history',
    'file-explorer': '#explorer',
    'rich-editor': '#rich-editor'
} as const;

const PATH_VIEW_MAPPING: Record<string, ShellView> = {
    "viewer": "markdown-viewer",
    "editor": "markdown-editor",
    "rich-editor": "rich-editor",
    "workcenter": "workcenter",
    "settings": "settings",
    "history": "history",
    "explorer": "file-explorer",
};

const getViewFromPathname = (): ShellView | null => {
    if (typeof window === "undefined") return null;
    const segment = (globalThis?.location?.pathname || "")
        .replace(/^\/+|\/+$/g, "")
        .toLowerCase();
    if (!segment) return null;
    return PATH_VIEW_MAPPING[segment] || null;
};



// Use the new safe localStorage helper
const loadLastSrc = () => safeLocalStorage.get(LAST_SRC_KEY);
const saveLastSrc = (src: string) => safeLocalStorage.set(LAST_SRC_KEY, src);

const isLikelyExtension = () => {
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

// Hash location management
const getViewFromHash = (): ShellView | null => {
    if (typeof window === "undefined") return null;
    const hash = globalThis?.location?.hash;
    return (HASH_VIEW_MAPPING as any)[hash] || null;
};

const setViewHash = (view: ShellView): void => {
    if (typeof window === "undefined") return;
    const hash = (VIEW_HASH_MAPPING as any)[view];
    if (hash) {
        globalThis?.history?.replaceState?.(null, '', hash);
    }
};

const applyTheme = (root: HTMLElement, theme: AppSettings["appearance"] extends infer A ? (A extends { theme?: infer T } ? T : never) : never) => {
    const prefersDark = typeof window !== "undefined" && globalThis?.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
    const resolved = theme === "dark" ? "dark" : theme === "light" ? "light" : prefersDark ? "dark" : "light";
    root.dataset.theme = resolved;
    // Drive scheme-aware styling (used by the markdown-view styles).
    try {
        root.style.colorScheme = resolved;
    } catch {
        // ignore
    }
};


const readMdFromUrlIfPossible = async (candidate: string): Promise<string | null> => {
    const s = candidate.trim();
    if (!s) return null;
    try {
        const u = new URL(s);
        if (!MARKDOWN_EXTENSION_PATTERN.test(u.pathname)) return null;
        const res = await fetch(u.href, { credentials: "include", cache: "no-store" });
        if (!res.ok) return null;
        return await res.text();
    } catch {
        return null;
    }
};

//
export const mountShellApp = (mountElement: HTMLElement, options: ShellOptions = {}) => {
    loadAsAdopted(style)

    //
    const root = H`<div class="app-shell" />` as HTMLElement;
    mountElement.replaceChildren(root);

    // Initialize icon system
    try {
        const sheet = ensureStyleSheet();
        reinitializeRegistry(); // Ensure registry is properly restored
        console.log('[Icons] Initialized stylesheet:', sheet);
    } catch (error) {
        console.error('[Icons] Failed to initialize stylesheet:', error);
    }

    // Add debug functions to window for troubleshooting icon issues
    if (typeof window !== "undefined" && typeof window != "undefined") {
        globalThis.clearIconCaches = () => {
            clearIconCaches();
            clearIconCache().catch(console.error);
            console.log('[Debug] Icon caches cleared');
        };
        globalThis.invalidateIconCache = clearIconCaches; // Alias for easier access
        globalThis.testIconRacing = testIconRacing; // Test racing functionality
        globalThis.reinitializeIconRegistry = reinitializeRegistry; // Reinitialize registry
        globalThis.debugIconSystem = debugIconSystem; // Debug icon system status
    }

    const ext = isLikelyExtension();


    // Initialize managers that are always needed
    const fileHandler = createFileHandler({
        onFilesAdded: (files: File[]): void => {
            // Process files through centralized content association system
            for (const file of files) {
                // Determine content type
                const contentType: ContentType = file.type?.startsWith('text/') ? 'text' :
                    file.type?.startsWith('image/') ? 'image' :
                        file.name?.toLowerCase().endsWith('.md') ? 'markdown' : 'file';

                // Determine context based on current view
                const context: ContentContext = state.view === 'workcenter' ? 'drag-drop' :
                    state.view === 'markdown-viewer' ? 'file-open' :
                        'file-open';

                // Process through centralized system (async, but we don't await)
                processInitialContent({
                    content: { file, filename: file.name, type: file.type },
                    contentType,
                    context,
                    source: 'manual',
                    metadata: {
                        title: `File: ${file.name}`,
                        filename: file.name,
                        mimeType: file.type
                    }
                }).then(() => {
                    showStatusMessage(`Processed ${file.name}`);
                }).catch((e) => {
                    console.warn(`[Main] Failed to process file ${file.name}:`, e);
                    showStatusMessage(`Failed to process ${file.name}`);
                });
            }
        },
        onError: (error: string) => {
            showStatusMessage(`File error: ${error}`);
        }
    });

    const templateManager = createTemplateManager();

    // Determine initial view based on content availability
    const hasExistingContent = globalThis?.localStorage?.getItem?.("rs-markdown") || options.initialMarkdown;
    const routeView = getViewFromPathname();
    const defaultView = options.initialView || routeView || (hasExistingContent ? "markdown-viewer" : "file-picker");

    /**
     * Create unified messaging handler for view switching
     */
    const createViewHandler = (destination: string, view: ShellView) => ({
        canHandle: (msg: any) => msg.destination === destination,
        handle: async (_msg: any) => {
            state.view = view;
            setViewHash(view);
            render();
        }
    });

    const isAttachmentMessage = (msg: any): boolean => {
        const type = String(msg?.type || "").trim().toLowerCase();
        return type === "content-attach" || type === "file-attach";
    };

    /**
     * Work center attachment logic (extracted for reuse)
     */
    const handleWorkCenterAttachment = async (msg: any, state: any, setViewHash: any, render: any, showStatusMessage: any, skipRender = false) => {
        // Prevent multiple simultaneous attachments
        if (workCenterAttachmentInProgress) {
            console.log('[Shell] Work center attachment already in progress, ignoring duplicate request');
            return;
        }
        workCenterAttachmentInProgress = true;

        try {
            // Set view to work center (only if not already set)
            if (state.view !== 'workcenter') {
                state.view = 'workcenter';
                setViewHash('workcenter');
            }

            // Convert payload to one or more file-like objects
            const filesToAttach: File[] = [];
            try {
                if (msg.data.file instanceof File) {
                    filesToAttach.push(msg.data.file);
                } else if (Array.isArray(msg.data.files)) {
                    const validFiles = msg.data.files.filter((file: unknown): file is File => file instanceof File);
                    if (validFiles.length > 0) {
                        filesToAttach.push(...validFiles);
                    }
                } else if (msg.data.blob instanceof Blob) {
                    const filename = msg.data.filename || `attachment-${Date.now()}.${msg.contentType === 'markdown' ? 'md' : 'txt'}`;
                    filesToAttach.push(new File([msg.data.blob], filename, { type: msg.data.blob.type }));
                } else if (msg.data.text || msg.data.content) {
                    const content = msg.data.text || msg.data.content;
                    const textContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
                    const filename = msg.data.filename || `content-${Date.now()}.${msg.contentType === 'markdown' ? 'md' : 'txt'}`;
                    const mimeType = msg.contentType === 'markdown' ? 'text/markdown' : 'text/plain';
                    filesToAttach.push(new File([textContent], filename, { type: mimeType }));
                    console.log('[Shell] Created file for attachment:', { filename, mimeType, size: textContent.length });
                }
            } catch (error) {
                console.warn('[Shell] Failed to create file from message data:', error);
                showStatusMessage("Failed to process content");
                return;
            }

            if (filesToAttach.length === 0) {
                console.warn('[Shell] No valid file content found in message');
                return;
            }

            // Trigger render only if not skipped (to prevent loops during initialization)
            if (!skipRender) {
                render();
            }

            // Wait for work center to be loaded and attach content
            for (const fileToAttach of filesToAttach) {
                // eslint-disable-next-line no-await-in-loop
                await attachToWorkCenterWhenReady(fileToAttach, state, showStatusMessage);
            }

        } finally {
            workCenterAttachmentInProgress = false;
        }
    };

    /**
     * Wait for work center to load and attach file
     */
    const attachToWorkCenterWhenReady = async (file: File, state: any, showStatusMessage: any) => {
        try {
            // If work center is already loaded, attach immediately
            if (state.managers.workCenter.instance) {
                state.managers.workCenter.instance.getState().files.push(file);
                // Update the UI after adding the file
                state.managers.workCenter.instance.ui.updateFileList(state.managers.workCenter.instance.getState());
                state.managers.workCenter.instance.ui.updateFileCounter(state.managers.workCenter.instance.getState());
                showStatusMessage(`Attached ${file.name} to Work Center`);
                return;
            }

            // Wait for work center to load
            let attempts = 0;
            const maxAttempts = 50; // 5 seconds max wait

            while (!state.managers.workCenter.instance && attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }

            if (state.managers.workCenter.instance) {
                state.managers.workCenter.instance.getState().files.push(file);

                // Update the UI after adding the file
                state.managers.workCenter.instance.ui.updateFileList(state.managers.workCenter.instance.getState());
                state.managers.workCenter.instance.ui.updateFileCounter(state.managers.workCenter.instance.getState());

                showStatusMessage(`Attached ${file.name} to Work Center`);
            } else {
                throw new Error('Work center failed to load');
            }

        } catch (error) {
            console.warn('[Shell] Failed to attach content to workcenter:', error);
            showStatusMessage("Failed to attach content");
        }
    };

    const state = {
        // Core app state
        view: defaultView as ShellView,
        markdown: typeof options.initialMarkdown === "string"
            ? options.initialMarkdown
            : ((localStorage.getItem("rs-markdown") ?? DEFAULT_MD) as string),
        editing: false,
        busy: false,
        message: "",
        history: [] as HistoryEntry[],
        lastSavedTheme: "auto" as AppSettings["appearance"] extends { theme?: infer T } ? (T extends string ? T : "auto") : "auto",

        // Core services (always available)
        services: {
            fileHandler,
            templateManager,
        },

        // Component managers (lazy loaded, with metadata)
        managers: {
            workCenter: {
                instance: null as any,
                initialized: false, // Track if work center has been initialized with messaging
            },
            history: {
                instance: null as any,
            },
        },

        // UI components (lazy loaded)
        components: {
            settings: {
                view: null as any,
            },
            markdown: {
                viewer: null as any,
                editor: null as any,
            },
            quill: {
                editor: null as any,
            },
            explorer: {
                element: null as any,
            },
        },
    };

    /**
     * Standard status message display with auto-hide
     */
    const showStatusMessage = (message: string, duration = 3000) => {
        state.message = message;
        // Defer status rendering to avoid racing the active view render cycle.
        setTimeout(() => {
            if (state.message === message) {
                renderStatus();
            }
        }, 0);
        setTimeout(() => {
            if (state.message === message) {
                state.message = "";
                renderStatus();
            }
        }, duration);
    };

    // Initialize unified messaging for this app instance
    // Initialize unified messaging handlers using helper functions
    unifiedMessaging.registerHandler('markdown-viewer', {
        canHandle: (msg: any) => msg.destination === 'markdown-viewer',
        handle: async (msg: any) => {
            if (msg.data?.text) {
                state.markdown = msg.data.text;
                state.view = 'markdown-viewer';
                persistMarkdown();
                render();
            }
        }
    });

    unifiedMessaging.registerHandler('workcenter', createViewHandler('workcenter', 'workcenter'));

    // Handler for viewer (places/renders content in view)
    unifiedMessaging.registerHandler('viewer', {
        canHandle: (msg: any) => msg.destination === 'viewer',
        handle: async (msg: any) => {
            // Default action: place/render content in view
            if (msg.data?.text || msg.data?.content) {
                const content = msg.data.text || msg.data.content;
                state.markdown = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
                state.view = 'markdown-viewer';
                setViewHash('markdown-viewer');
                persistMarkdown();
                // Path-based navigation may not trigger hash-driven re-rendering.
                render();
                showStatusMessage("Content loaded in viewer");
            }
        }
    });

    // Handler for workcenter:
    // - If WorkCenter is mounted, forward directly to it (updates attachments + results UI)
    // - Otherwise, enqueue into pending inbox and navigate to WorkCenter so it can drain on mount.
    unifiedMessaging.registerHandler('workcenter', {
        canHandle: (msg: any) => msg.destination === 'workcenter',
        handle: async (msg: any) => {
            const instance = state.managers?.workCenter?.instance;
            if (instance) {
                try {
                    if (isAttachmentMessage(msg)) {
                        await handleWorkCenterAttachment(msg, state, setViewHash, render, showStatusMessage, true);
                    } else if (instance?.handleExternalMessage) {
                        await instance.handleExternalMessage(msg);
                    }
                } catch (e) {
                    console.error('[Shell] WorkCenter message handling failed:', e);
                }
                return;
            }

            try {
                enqueuePendingMessage('workcenter', msg as any);
            } catch (e) {
                console.warn('[Shell] Failed to enqueue pending workcenter message:', e);
            }

            // Auto-open WorkCenter so queued messages get processed and shown.
            if (state.view !== 'workcenter') {
                state.view = 'workcenter';
                setViewHash('workcenter');
                render();
            }
        }
    });

    // Handler for explorer destination (saves to OPFS or performs file operations)
    unifiedMessaging.registerHandler('explorer', {
        canHandle: (msg: any) => msg.destination === 'explorer',
        handle: async (msg: any) => {
            // Ensure explorer view is active
            if (state.view !== 'file-explorer') {
                state.view = 'file-explorer';
                setViewHash('file-explorer');
                render();
            }

            // Handle different explorer actions
            setTimeout(async () => {
                try {
                    const action = msg.data?.action || 'save';
                    const path = msg.data?.path || msg.data?.into || '/';

                    if (action === 'save' && (msg.data?.file || msg.data?.text || msg.data?.content)) {
                        // Save content to OPFS
                        let fileToSave: File | null = null;

                        if (msg.data.file instanceof File) {
                            fileToSave = msg.data.file;
                        } else if (msg.data.blob instanceof Blob) {
                            const filename = msg.data.filename || `file-${Date.now()}`;
                            fileToSave = new File([msg.data.blob], filename, { type: msg.data.blob.type });
                        } else if (msg.data.text || msg.data.content) {
                            const content = msg.data.text || msg.data.content;
                            const textContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
                            const filename = msg.data.filename || `content-${Date.now()}.txt`;
                            fileToSave = new File([textContent], filename, { type: 'text/plain' });
                        }

                        if (fileToSave && state.components.explorer.element) {
                            // Navigate to target path first
                            if (path && path !== state.components.explorer.element.path) {
                                state.components.explorer.element.path = path;
                            }

                            // Use the file explorer's upload functionality
                            // This simulates uploading a file to the current directory
                            console.log(`[Shell] Saving file ${fileToSave.name} to Explorer at: ${path}`);
                            state.message = `Saved ${fileToSave.name} to Explorer`;
                            renderStatus();
                            setTimeout(() => {
                                state.message = "";
                                renderStatus();
                            }, 3000);
                        }
                    } else if (action === 'view' && msg.data?.path) {
                        // Navigate to path for viewing
                        if (state.components.explorer.element && path) {
                            state.components.explorer.element.path = path;
                            console.log(`[Shell] Navigated Explorer to path: ${path}`);
                            state.message = `Opened Explorer at ${path}`;
                            renderStatus();
                            setTimeout(() => {
                                state.message = "";
                                renderStatus();
                            }, 2000);
                        }
                    } else if (action === 'place' && msg.data?.place && msg.data?.into) {
                        // Place data into specific path
                        const targetPath = msg.data.into;
                        if (state.components.explorer.element && targetPath) {
                            state.components.explorer.element.path = targetPath;
                            console.log(`[Shell] Navigated Explorer to place data at: ${targetPath}`);
                            state.message = `Explorer ready at ${targetPath}`;
                            renderStatus();
                            setTimeout(() => {
                                state.message = "";
                                renderStatus();
                            }, 3000);
                        }
                    } else if (action === 'navigate' && path) {
                        // Simple navigation
                        if (state.components.explorer.element) {
                            state.components.explorer.element.path = path;
                            state.message = `Explorer navigated to ${path}`;
                            renderStatus();
                            setTimeout(() => {
                                state.message = "";
                                renderStatus();
                            }, 2000);
                        }
                    }
                } catch (error) {
                    console.warn('[Shell] Failed to handle explorer action:', error);
                    state.message = "Failed to perform Explorer action";
                    renderStatus();
                    setTimeout(() => {
                        state.message = "";
                        renderStatus();
                    }, 3000);
                }
            }, 100);
        }
    });

    // Handler for print destination (renders as printable content)
    unifiedMessaging.registerHandler('print', {
        canHandle: (msg: any) => msg.destination === 'print',
        handle: async (msg: any) => {
            // Default action: render as printable content
            if (msg.data?.text || msg.data?.content) {
                const content = msg.data.text || msg.data.content;
                const printableContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);

                // Open print dialog with the content
                const printWindow = globalThis?.open?.('', '_blank', 'width=800,height=600');
                if (printWindow) {
                    printWindow.document.write(`
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <title>Print - CrossWord</title>
                            <style>
                                body { font-family: system-ui, -apple-system, sans-serif; margin: 2rem; line-height: 1.6; }
                                pre { white-space: pre-wrap; word-wrap: break-word; }
                                @media print { body { margin: 1rem; } }
                            </style>
                        </head>
                        <body>
                            <pre>${printableContent.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
                        </body>
                        </html>
                    `);
                    printWindow.document.close();
                    printWindow.print();
                }
            }
        }
    });

    // Setup hash location support
    if (typeof window !== "undefined") {
        const handleHashChange = (): void => {
            const hashView = getViewFromHash();
            if (hashView && hashView !== state.view) {
                console.log(`[HashChange] Switching to view: ${hashView} from hash`);
                state.view = hashView;
                render();
            }
        };

        // Listen for hash changes
        globalThis?.addEventListener?.('hashchange', handleHashChange);

        // Check initial hash
        const initialHashView = getViewFromHash();
        if (initialHashView) {
            state.view = initialHashView;

            // Check for pending messages for the initial view
            const destinationMap: Record<string, Destination> = {
                'markdown-viewer': 'viewer',
                'markdown-editor': 'markdown-editor',
                'rich-editor': 'rich-editor',
                'workcenter': 'workcenter',
                'file-explorer': 'explorer'
            };

            const destination = destinationMap[initialHashView];
            if (destination && hasPendingMessages(destination)) {
                console.log(`[Main] Found pending messages for initial view ${initialHashView}`);
                // Messages will be processed when the component initializes
            }
        }
    }

    // Process initial files using centralized content association system
    if (Array.isArray(options.initialFiles) && options.initialFiles.length > 0) {
        console.log(`[Main] Processing ${options.initialFiles.length} initial files`);

        for (const file of options.initialFiles) {
            // Determine content type
            const contentType: ContentType = file.type?.startsWith('text/') ? 'text' :
                file.type?.startsWith('image/') ? 'image' :
                    file.name?.toLowerCase().endsWith('.md') ? 'markdown' : 'file';

            // Process through centralized system (async, but we don't await)
            processInitialContent({
                content: { file, filename: file.name, type: file.type },
                contentType,
                context: 'launch-queue',
                source: 'launch-queue',
                metadata: {
                    title: `Launch Queue: ${file.name}`,
                    filename: file.name,
                    mimeType: file.type
                }
            }).then(() => {
                state.message = `Processed ${file.name}`;
                renderStatus();
            }).catch((e) => {
                console.warn(`[Main] Failed to process initial file ${file.name}:`, e);
            });
        }
    }

    // Process cached content from service worker
    fetchSwCachedEntries().then(entries => {
        const cachedContent = entries.map((entry) => ({
            ...(entry.content && typeof entry.content === "object" ? entry.content as Record<string, unknown> : {}),
            content: entry.content,
            timestamp: (entry.content as any)?.timestamp,
            cacheKey: entry.key,
            swContext: entry.context
        }));
        if (cachedContent.length > 0) {
            console.log(`[Main] Processing ${cachedContent.length} cached content items from SW`);

            for (const cachedItem of cachedContent) {
                try {
                    // Determine content type and context
                    let contentType: ContentType = 'text';
                    let context: ContentContext = 'share-target';
                    const cachedData = (cachedItem.content || {}) as any;

                    if (cachedData.files?.length > 0) {
                        contentType = 'file';
                    } else if (cachedData.url) {
                        contentType = 'url';
                    }

                    if (cachedItem.swContext) {
                        context = cachedItem.swContext as ContentContext;
                    }

                    // Process through centralized system
                    processInitialContent({
                        content: cachedData,
                        contentType,
                        context,
                        source: 'service-worker',
                        metadata: {
                            title: `SW Cached: ${cachedItem.swContext || 'content'}`,
                            fromSW: true,
                            cacheKey: cachedItem.cacheKey,
                            timestamp: cachedItem.timestamp
                        }
                    }).then(() => {
                        state.message = `Processed cached content`;
                        renderStatus();
                        setTimeout(() => {
                            state.message = "";
                            renderStatus();
                        }, 2000);
                    }).catch((e) => {
                        console.warn(`[Main] Failed to process SW cached content:`, e);
                    });

                } catch (error) {
                    console.warn(`[Main] Failed to process cached item:`, error);
                }
            }
        }
    }).catch(error => {
        console.warn('[Main] Failed to retrieve SW cached content:', error);
    });

    const persistMarkdown = () => {
        try {
            if (state.markdown) localStorage.setItem("rs-markdown", state.markdown);
        } catch {
            // ignore
        }
    };

    const persistHistory = () => {
        try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history.slice(-50)));
        } catch {
            // ignore
        }
    };

    const renderToolbar = () => {
        const isMarkdownView = state.view === "markdown-viewer" || state.view === "markdown-editor";
        const isEditorView = state.view === "markdown-editor";
        const isWorkCenterView = state.view === "workcenter";

        return H`<div class="toolbar">
      <div class="left">
        <button class="btn ${state.view === 'markdown-viewer' ? 'active' : ''}" data-action="view-markdown-viewer" type="button" title="Markdown Viewer">
          <ui-icon icon="eye" icon-style="duotone"></ui-icon>
          <span>Viewer</span>
        </button>
        <button class="btn ${state.view === 'file-explorer' ? 'active' : ''}" data-action="view-file-explorer" type="button" title="File Explorer">
          <ui-icon icon="folder" icon-style="duotone"></ui-icon>
          <span>Explorer</span>
        </button>
        <button class="btn ${state.view === 'workcenter' ? 'active' : ''}" data-action="view-workcenter" type="button" title="AI Work Center">
          <ui-icon icon="lightning" icon-style="duotone"></ui-icon>
          <span>Work Center</span>
          ${state.managers.workCenter.instance && state.managers.workCenter.instance.getState().files.length > 0 ? H`<span class="workcenter-badge" title="${state.managers.workCenter.instance.getState().files.length} files ready for processing">${state.managers.workCenter.instance.getState().files.length}</span>` : ''}
        </button>
        <button class="btn ${state.view === 'settings' ? 'active' : ''}" data-action="view-settings" type="button" title="Settings">
          <ui-icon icon="gear" icon-style="duotone"></ui-icon>
          <span>Settings</span>
        </button>
        <button class="btn ${state.view === 'history' ? 'active' : ''}" data-action="view-history" type="button" title="History">
          <ui-icon icon="clock-counter-clockwise" icon-style="duotone"></ui-icon>
          <span>History</span>
        </button>
      </div>
      <div class="right">
        ${isEditorView ? H`<button class="btn btn-icon" data-action="open-md" type="button" title="Open Markdown File">
          <ui-icon icon="folder-open" size="18" icon-style="duotone"></ui-icon>
          <span class="btn-text">Open</span>
        </button>
        <button class="btn btn-icon" data-action="save-md" type="button" title="Save to File">
          <ui-icon icon="floppy-disk" size="18" icon-style="duotone"></ui-icon>
          <span class="btn-text">Save</span>
        </button>
        <button class="btn btn-icon" data-action="export-md" type="button" title="Export as Markdown">
          <ui-icon icon="download" size="18" icon-style="duotone"></ui-icon>
          <span class="btn-text">Export</span>
        </button>
        <button class="btn btn-icon" data-action="export-docx" type="button" title="Export as DOCX">
          <ui-icon icon="file-doc" size="18" icon-style="duotone"></ui-icon>
          <span class="btn-text">DOCX</span>
        </button>` : ''}
        ${isMarkdownView ? H`<button class="btn" data-action="voice" type="button" title="Voice Input">
          <ui-icon icon="microphone" icon-style="duotone"></ui-icon>
          <span>Voice</span>
        </button>` : ''}
        ${isWorkCenterView ? H`<button class="btn" data-action="process-content" type="button" title="Process Content">
          <ui-icon icon="brain" icon-style="duotone"></ui-icon>
          <span>Process</span>
        </button>
        <button class="btn" data-action="save-to-explorer" type="button" title="Save Results to Explorer">
          <ui-icon icon="floppy-disk" icon-style="duotone"></ui-icon>
          <span>Save to Explorer</span>
        </button>` : ''}
        ${ext ? H`<button class="btn" data-action="snip" type="button" title="Screen Capture">
          <ui-icon icon="camera" icon-style="duotone"></ui-icon>
          <span>Snip</span>
        </button>` : ""}
      </div>
    </div>` as HTMLElement;
    };

    let toolbar = renderToolbar();

    const statusLine = H`<div class="status" aria-live="polite"></div>` as HTMLElement;
    const content = H`<div class="content"></div>` as HTMLElement;
    root.append(toolbar, content);

    // Setup file input for markdown view
    const fileInput = H`<input class="file-input" type="file" accept=".md,text/markdown,text/plain" />` as HTMLInputElement;
    fileInput.style.display = "none";
    root.append(fileInput);

    // Setup file handling for work center
    state.services.fileHandler.setupCompleteFileHandling(
        root,
        H`<button style="display:none">File Select</button>` as HTMLElement,
        undefined, // No specific drop zone - handle globally
        "*" // Accept all files for work center
    );

    const renderStatus = () => {
        statusLine.textContent = state.message || (state.busy ? "Working…" : "");
        root.toggleAttribute("data-busy", state.busy);
    };

    const renderMarkdownViewer = async () => {
        // Show loading state
        const loadingElement = H`<div class="component-loading">
      <div class="loading-spinner"></div>
      <span>Loading Markdown Viewer...</span>
    </div>` as HTMLElement;

        content.append(loadingElement);

        try {
            // Lazy load markdown viewer
            const viewerModule = await getCachedComponent(
                'markdown-viewer',
                () => import('frontend/views/viewer'),
                { componentName: 'MarkdownViewer' }
            );

            const viewer = viewerModule.component.createMarkdownView({
                content: state.markdown || DEFAULT_MD,
                title: "Markdown Viewer",
                onOpen: () => {
                    // Trigger file input for opening markdown files
                    fileInput.click();
                },
                onCopy: (_content) => {
                    state.message = "Content copied to clipboard";
                    renderStatus();
                    setTimeout(() => {
                        state.message = "";
                        renderStatus();
                    }, 2000);
                },
                onDownload: (_content) => {
                    state.message = "Content downloaded as markdown file";
                    renderStatus();
                    setTimeout(() => {
                        state.message = "";
                        renderStatus();
                    }, 2000);
                },
                onAttachToWorkCenter: async (content: string) => {
                    try {
                        // Use unified messaging with override factors for explicit workcenter attachment
                        const message = createMessageWithOverrides(
                            'content-share',
                            'main-app',
                            'markdown',
                            {
                                text: content,
                                filename: `content-${Date.now()}.md`
                            },
                            ['explicit-workcenter'], // Override default viewer association
                            'button-attach-workcenter' // Use button-specific processing rules
                        );

                        // Add metadata
                        message.metadata = {
                            title: 'Content from Viewer',
                            timestamp: Date.now(),
                            source: 'markdown-viewer'
                        };

                        await unifiedMessaging.sendMessage(message);
                    } catch (error) {
                        // Handle throttling errors gracefully
                        if (error instanceof Error && error.message.includes('throttled')) {
                            console.log('[Main] Message creation throttled - ignoring duplicate action');
                        } else {
                            console.error('[Main] Failed to create attach message:', error);
                            showStatusMessage("Failed to attach content - please wait a moment");
                        }
                    }
                },
                onPrint: async (content: string) => {
                    // Use unified messaging to send to print destination
                    await unifiedMessaging.sendMessage({
                        id: crypto.randomUUID(),
                        type: 'content-print',
                        source: 'viewer',
                        destination: 'print',
                        contentType: 'markdown',
                        data: {
                            text: content,
                            filename: `print-${Date.now()}.md`
                        },
                        metadata: {
                            title: 'Print Content',
                            timestamp: Date.now(),
                            source: 'markdown-viewer'
                        }
                    });
                }
            });

            const viewerElement = viewer.render();

            // Set up drag and drop handling
            fileHandler.setupDragAndDrop(viewerElement);
            fileHandler.setupPasteHandling(viewerElement);

            // Register component for catch-up messaging
            registerComponent('markdown-viewer', 'viewer');

            // Initialize component with catch-up messaging
            const pendingMessages = initializeComponent('markdown-viewer');

            // Process any pending messages directly in viewer logic (no render calls)
            let contentLoaded = false;
            for (const message of pendingMessages) {
                const pending = message as any;
                console.log(`[Viewer] Processing pending message:`, pending);
                if (pending.data?.text || pending.data?.content) {
                    const content = pending.data.text || pending.data.content;
                    state.markdown = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
                    persistMarkdown();
                    contentLoaded = true;
                }
            }
            if (contentLoaded) {
                // Update the viewer content without triggering render
                (viewer as any)?.updateContent?.(state.markdown);
                showStatusMessage("Content loaded in viewer");
            }

            // Replace loading element with actual content
            loadingElement.replaceWith(viewerElement);
            return viewerElement;

        } catch (error) {
            console.error('Failed to load markdown viewer:', error);
            const errorElement = H`<div class="component-error">
        <h3>Failed to load Markdown Viewer</h3>
        <p>Please try refreshing the page.</p>
      </div>` as HTMLElement;
            loadingElement.replaceWith(errorElement);
            return errorElement;
        }
    };

    const renderMarkdownEditor = async () => {
        // Show loading state
        const loadingElement = H`<div class="component-loading">
      <div class="loading-spinner"></div>
      <span>Loading Markdown Editor...</span>
    </div>` as HTMLElement;

        content.append(loadingElement);

        try {
            // Lazy load markdown editor
            const editorModule = await getCachedComponent(
                'markdown-editor',
                () => import("views/editor/editors/MarkdownEditor"),
                { componentName: 'MarkdownEditor' }
            );

            const editor = editorModule.component.createMarkdownEditor({
                initialContent: state.markdown || "",
                onContentChange: (content) => {
                    state.markdown = content;
                    persistMarkdown();
                },
                onSave: (content) => {
                    state.markdown = content;
                    persistMarkdown();
                    state.message = "Content saved";
                    renderStatus();
                    setTimeout(() => {
                        state.message = "";
                        renderStatus();
                    }, 2000);
                },
                placeholder: "Start writing your markdown here...",
                autoSave: true,
                autoSaveDelay: 2000
            });

            const editorElement = editor.render();

            // Register component for catch-up messaging
            registerComponent('markdown-editor', 'markdown-editor');

            // Initialize component with catch-up messaging
            const pendingMessages = initializeComponent('markdown-editor');

            // Process any pending messages directly in editor logic (no render calls)
            let contentLoaded = false;
            for (const message of pendingMessages) {
                const pending = message as any;
                console.log(`[Editor] Processing pending message:`, pending);
                if (pending.data?.text || pending.data?.content) {
                    const content = pending.data.text || pending.data.content;
                    state.markdown = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
                    persistMarkdown();
                    contentLoaded = true;
                }
            }
            if (contentLoaded) {
                // Update the editor content without triggering render
                (editor as any)?.updateContent?.(state.markdown);
                showStatusMessage("Content loaded in editor");
            }

            // Replace loading element with actual content
            loadingElement.replaceWith(editorElement);
            return editorElement;

        } catch (error) {
            console.error('Failed to load markdown editor:', error);
            const errorElement = H`<div class="component-error">
        <h3>Failed to load Markdown Editor</h3>
        <p>Please try refreshing the page.</p>
      </div>` as HTMLElement;
            loadingElement.replaceWith(errorElement);
            return errorElement;
        }
    };

    const renderRichEditor = async () => {
        // Show loading state
        const loadingElement = H`<div class="component-loading">
      <div class="loading-spinner"></div>
      <span>Loading Rich Editor...</span>
    </div>` as HTMLElement;

        content.append(loadingElement);

        try {
            // Lazy load quill editor
            const editorModule = await getCachedComponent(
                'quill-editor',
                () => import("views/editor/editors/QuillEditor"),
                { componentName: 'QuillEditor' }
            );

            const editor = editorModule.component.createQuillEditor({
                initialContent: state.markdown || "",
                onContentChange: (content) => {
                    state.markdown = content;
                    persistMarkdown();
                },
                onSave: (content) => {
                    state.markdown = content;
                    persistMarkdown();
                    state.message = "Content saved";
                    renderStatus();
                    setTimeout(() => {
                        state.message = "";
                        renderStatus();
                    }, 2000);
                },
                placeholder: "Start writing your rich text here...",
                autoSave: true,
                autoSaveDelay: 2000
            });

            const editorElement = editor.render();

            // Register component for catch-up messaging
            registerComponent('rich-editor', 'rich-editor');

            // Initialize component with catch-up messaging
            const pendingMessages = initializeComponent('rich-editor');

            // Process any pending messages directly in rich editor logic (no render calls)
            let contentLoaded = false;
            for (const message of pendingMessages) {
                const pending = message as any;
                console.log(`[RichEditor] Processing pending message:`, pending);
                if (pending.data?.text || pending.data?.content) {
                    const content = pending.data.text || pending.data.content;
                    state.markdown = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
                    persistMarkdown();
                    contentLoaded = true;
                }
            }
            if (contentLoaded) {
                // Update the editor content without triggering render
                (editor as any)?.updateContent?.(state.markdown);
                showStatusMessage("Content loaded in rich editor");
            }

            // Replace loading element with actual content
            loadingElement.replaceWith(editorElement);
            return editorElement;

        } catch (error) {
            console.error('Failed to load rich editor:', error);
            const errorElement = H`<div class="component-error">
        <h3>Failed to load Rich Editor</h3>
        <p>Please try refreshing the page.</p>
      </div>` as HTMLElement;
            loadingElement.replaceWith(errorElement);
            return errorElement;
        }
    };

    const renderHistoryView = async () => {
        // Show loading state
        const loadingElement = H`<div class="component-loading">
      <div class="loading-spinner"></div>
      <span>Loading History...</span>
    </div>` as HTMLElement;

        content.append(loadingElement);

        try {
            // Lazy load history manager
            const historyModule = await getCachedComponent(
                'history-manager',
                () => import("../../../lur.e/src/interactive/modules/HistoryManager"),
                { componentName: 'HistoryManager' }
            );

            const historyManager = historyModule.component.createHistoryManager();

            // Load history if not already loaded
            if (state.history.length === 0) {
                state.history = historyManager.getAllEntries();
            }

            const historyElement = historyManager.createHistoryView((entry) => {
                // Handle entry selection - restore prompt to work center
                if (state.view === 'workcenter') {
                    // Lazy load work center if needed
                    getCachedComponent(
                        'workcenter',
                        () => import("views/workcenter/ts/WorkCenter").then((m) => m.WorkCenterManager),
                        { componentName: 'WorkCenter' }
                    ).then(() => {
                        if (state.managers.workCenter.instance) {
                            state.managers.workCenter.instance.getState().currentPrompt = entry.prompt;
                            // Don't call render() directly - let component handle its own updates
                        }
                    });
                }
            });

            // Register component for catch-up messaging
            registerComponent('history-view', 'history');

            // Initialize component with catch-up messaging
            const pendingMessages = initializeComponent('history-view');

            // Process any pending messages directly in history logic (no render calls)
            for (const message of pendingMessages) {
                console.log(`[History] Processing pending message:`, message);
                // History component handles its own message processing
                if (message.type === 'navigation') {
                    // Handle navigation to history view (don't call render here to prevent loops)
                    state.view = 'history';
                    // Schedule a render instead of calling it directly
                    setTimeout(() => render(), 0);
                }
            }

            // Replace loading element with actual content
            loadingElement.replaceWith(historyElement);
            return historyElement;

        } catch (error) {
            console.error('Failed to load history view:', error);
            const errorElement = H`<div class="component-error">
        <h3>Failed to load History View</h3>
        <p>Please try refreshing the page.</p>
      </div>` as HTMLElement;
            loadingElement.replaceWith(errorElement);
            return errorElement;
        }
    };


    //
    if (typeof BroadcastChannel !== "undefined") {
        try {
            // Listen for share target operations
            const shareChannel = new BroadcastChannel(CHANNELS.SHARE_TARGET);
            shareChannel.addEventListener("message", (event) => {
                const { type, data } = event.data || {};
                if (type === "share-received" && data) {
                    // Record share target reception in history
                    state.history.push({
                        ts: Date.now(),
                        prompt: "Share Target",
                        before: data.title || data.text || data.url || "Shared content",
                        after: data.title || data.text || data.url || "Shared content",
                        ok: true
                    });
                    persistHistory();

                    // Don't call render() in message handlers to prevent loops
                    // History component will update itself when needed
                }
            });

            // Listen for clipboard copy operations from service worker
            const clipboardChannel = new BroadcastChannel(CHANNELS.CLIPBOARD);
            clipboardChannel.addEventListener("message", (event) => {
                const { type, data } = event.data || {};
                if (type === "copy" && data) {
                    // Record clipboard copy operation in history
                    state.history.push({
                        ts: Date.now(),
                        prompt: "Clipboard Copy",
                        before: "",
                        after: typeof data === "string" ? data : JSON.stringify(data),
                        ok: true
                    });
                    persistHistory();

                    // Don't call render() in message handlers to prevent loops
                    // History component will update itself when needed
                }
            });

            // Listen for unified messaging system channels
            const basicAppChannel = new BroadcastChannel('app-shell');
            basicAppChannel.addEventListener("message", (event) => {
                const message = event.data;
                console.log('[Shell] Received message:', message);

                if (message.type === 'content-view') {
                    // Handle content for viewer
                    if (message.data?.text || message.data?.content) {
                        const content = message.data.text || message.data.content;
                        state.markdown = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
                        state.view = 'markdown-viewer';
                        setViewHash('markdown-viewer');
                        persistMarkdown();
                        render();
                        showStatusMessage("Content loaded in viewer");
                    }
                } else if (message.type === 'content-attach') {
                    // Handle content attachment for work center
                    handleWorkCenterAttachment(message, state, setViewHash, render, showStatusMessage);
                } else if (message.type === 'navigation') {
                    // Handle navigation messages.
                    if (message.destination === 'settings') {
                        state.view = 'settings';
                        setViewHash('settings');
                        render();
                    } else if (message.destination === 'history') {
                        state.view = 'history';
                        setViewHash('history');
                        render();
                    }
                }
            });

            // Listen for main app navigation messages
            const mainAppChannel = new BroadcastChannel('main-app');
            mainAppChannel.addEventListener("message", (event) => {
                const message = event.data;
                console.log('[MainApp] Received message:', message);

                if (message.type === 'navigation') {
                    if (message.destination === 'settings') {
                        state.view = 'settings';
                        setViewHash('settings');
                        render();
                    } else if (message.destination === 'history') {
                        state.view = 'history';
                        setViewHash('history');
                        render();
                    }
                }
            });

            // Listen for file explorer messages
            const fileExplorerChannel = new BroadcastChannel(getBroadcastChannelForDestination('explorer') || 'file-explorer');
            fileExplorerChannel.addEventListener("message", (event) => {
                const message = event.data;
                console.log('[FileExplorer] Received message:', message);

                if (message.type === 'content-explorer') {
                    // Handle explorer operations (avoid render calls to prevent loops)
                    if (state.view !== 'file-explorer') {
                        state.view = 'file-explorer';
                        setViewHash('file-explorer');
                        // In path-based navigation there may be no hashchange event.
                        // Render immediately so /explorer transitions are visible.
                        render();
                    }

                    // Process explorer action
                    setTimeout(async () => {
                        try {
                            const action = message.data?.action || 'save';
                            const path = message.data?.path || message.data?.into || '/';

                            if (action === 'save' && (message.data?.file || message.data?.text || message.data?.content)) {
                                // Save content to explorer
                                let fileToSave: File | null = null;

                                if (message.data.file instanceof File) {
                                    fileToSave = message.data.file;
                                } else if (message.data.blob instanceof Blob) {
                                    const filename = message.data.filename || `file-${Date.now()}`;
                                    fileToSave = new File([message.data.blob], filename, { type: message.data.blob.type });
                                } else if (message.data.text || message.data.content) {
                                    const content = message.data.text || message.data.content;
                                    const textContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
                                    const filename = message.data.filename || `content-${Date.now()}.txt`;
                                    fileToSave = new File([textContent], filename, { type: 'text/plain' });
                                }

                                if (fileToSave && state.components.explorer.element) {
                                    // Navigate to target path first
                                    if (path && path !== state.components.explorer.element.path) {
                                        state.components.explorer.element.path = path;
                                    }
                                    showStatusMessage(`Saved ${fileToSave.name} to Explorer`);
                                }
                            } else if (action === 'view' && message.data?.path) {
                                // Navigate to path for viewing
                                if (state.components.explorer.element && path) {
                                    state.components.explorer.element.path = path;
                                    showStatusMessage(`Opened Explorer at ${path}`);
                                }
                            }
                        } catch (error) {
                            console.warn('[FileExplorer] Failed to handle message:', error);
                            showStatusMessage("Failed to perform Explorer action");
                        }
                    }, 100);
                }
            });

            // Listen for print viewer messages
            const printViewerChannel = new BroadcastChannel(getBroadcastChannelForDestination('print') || 'print-viewer');
            printViewerChannel.addEventListener("message", (event) => {
                const message = event.data;
                console.log('[PrintViewer] Received message:', message);

                if (message.type === 'content-print') {
                    // Handle printable content
                    if (message.data?.text || message.data?.content) {
                        const content = message.data.text || message.data.content;
                        const printableContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);

                        // Open print dialog
                        const printWindow = globalThis?.open?.('', '_blank', 'width=800,height=600');
                        if (printWindow) {
                            printWindow.document.write(`
                                <!DOCTYPE html>
                                <html>
                                <head>
                                    <title>Print - CrossWord</title>
                                    <style>
                                        body { font-family: system-ui, -apple-system, sans-serif; margin: 2rem; line-height: 1.6; }
                                        pre { white-space: pre-wrap; word-wrap: break-word; }
                                        @media print { body { margin: 1rem; } }
                                    </style>
                                </head>
                                <body>
                                    <pre>${printableContent.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
                                </body>
                                </html>
                            `);
                            printWindow.document.close();
                            printWindow.print();
                        }
                    }
                }
            });

        } catch (error) {
            console.error('[Broadcast] Failed to initialize broadcast listeners:', error);
        }
    }

    const exportMarkdown = () => {
        const blob = new Blob([state.markdown || ""], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `crossword-${Date.now()}.md`;
        a.rel = "noopener";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 250);
    };

    const saveToFile = async () => {
        const md = state.markdown;
        if (!md?.trim()) return;

        try {
            // Use File System Access API if available
            if ('showSaveFilePicker' in globalThis) {
                const handle = await globalThis?.showSaveFilePicker?.({
                    suggestedName: 'document.md',
                    types: [{
                        description: 'Markdown Files',
                        accept: {
                            'text/markdown': ['.md']
                        }
                    }]
                });

                const writable = await handle.createWritable();
                await writable.write(md);
                await writable.close();

                state.message = "File saved successfully!";
                renderStatus();
                setTimeout(() => {
                    state.message = "";
                    renderStatus();
                }, 3000);
            } else {
                // Fallback: trigger download
                exportMarkdown();
            }
        } catch (error) {
            console.error('Failed to save file:', error);
            // Fallback to download if user cancels or API fails
            if ((error as any).name !== 'AbortError') {
                exportMarkdown();
            }
        }
    };

    const runPrompt = async (promptText: string, customAIFunction?: Function) => {
        if (!promptText.trim()) return;
        state.busy = true;
        state.message = customAIFunction ? "Processing…" : "Generating markdown…";
        renderStatus();

        const before = state.markdown || "";
        const instructions =
            "Generate a NEW markdown document.\n" +
            "Requirements:\n" +
            "- Output ONLY markdown.\n" +
            "- Use the prompt and the current markdown as context.\n" +
            "- Keep it concise, structured with headings and lists.\n" +
            "- If you need to keep prior content, integrate it rather than repeating verbatim.\n";

        const input = [
            {
                role: "user",
                content: `Prompt:\n${promptText}\n\nCurrent markdown:\n${before}`,
            },
        ];

        try {
            const res = customAIFunction
                ? await customAIFunction(input, { useActiveInstruction: true })
                : await (await import("com/service/processing/unified")).recognizeByInstructions(input, instructions);
            const after = res?.ok && res?.data ? String(res.data) : "";

            state.history.push({
                ts: Date.now(),
                prompt: promptText,
                before,
                after: after || before,
                ok: Boolean(res?.ok && after),
                error: res?.ok ? undefined : res?.error || "Failed",
            });
            persistHistory();

            if (after) {
                state.markdown = after;
                persistMarkdown();
                saveLastSrc("");
                state.message = "Done.";
            } else {
                state.message = res?.error || "No output.";
            }
        } catch (e) {
            state.history.push({
                ts: Date.now(),
                prompt: promptText,
                before,
                after: before,
                ok: false,
                error: String(e),
            });
            persistHistory();
            state.message = String(e);
        } finally {
            state.busy = false;
            renderStatus();
            void render();
            setTimeout(() => {
                if (state.message === "Done.") {
                    state.message = "";
                    renderStatus();
                }
            }, 1200);
        }
    };

    // Render protection to prevent loops
    let isRendering = false;
    let renderScheduled = false;

    const render = async () => {
        // Prevent recursive render calls
        if (isRendering) {
            renderScheduled = true;
            return;
        }

        isRendering = true;
        renderScheduled = false;

        try {
            // Update toolbar for current view
            const newToolbar = renderToolbar();
            toolbar.replaceWith(newToolbar);
            // Update reference
            toolbar = newToolbar;
            // Re-attach event listeners
            attachToolbarListeners();

            // Update hash to match current view
            setViewHash(state.view);

            content.replaceChildren();

            // ============================================================================
            // VIEW RENDERING MAP - Optimized with switch/case and unified error handling
            // ============================================================================

            // Common error handler for component loading failures
            const handleComponentError = (componentName: string, error: any) => {
                console.error(`Failed to load ${componentName}:`, error);
                content.innerHTML = `<div class="component-error"><h3>Failed to load ${componentName}</h3><p>Please try refreshing the page.</p></div>`;
                renderStatus();
            };

            // Common success handler for component rendering
            const handleComponentSuccess = (element: HTMLElement) => {
                content.append(element);
                renderStatus();
            };

            // View rendering configuration map
            const viewRenderers: Record<string, () => Promise<HTMLElement> | void> = {
                'settings': async () => {
                    content.innerHTML = '<div class="component-loading"><div class="loading-spinner"></div><span>Loading Settings...</span></div>';

                    const settingsModule = await loadComponent('settings',
                        () => import("views/settings"),
                        { componentName: 'Settings' }
                    );

                    const settingsEl = settingsModule.component.createSettingsView({
                        isExtension: isLikelyExtension(),
                        onTheme: (t) => applyTheme(root, t),
                    });

                    // Register component for catch-up messaging
                    registerComponent('settings-view', 'settings');

                    // Initialize component with catch-up messaging
                    const pendingMessages = initializeComponent('settings-view');

                    // Process any pending messages directly in settings logic (no render calls)
                    for (const message of pendingMessages) {
                        console.log(`[Settings] Processing pending message:`, message);
                        // Settings component handles its own message processing
                        if (message.type === 'navigation') {
                            // Handle navigation to settings view (don't call render here to prevent loops)
                            state.view = 'settings';
                            // Schedule a render instead of calling it directly
                            setTimeout(() => render(), 0);
                        }
                    }

                    content.innerHTML = '';
                    return settingsEl;
                },

                'file-explorer': async () => {
                    content.innerHTML = '<div class="component-loading"><div class="loading-spinner"></div><span>Loading File Explorer...</span></div>';

                    await loadComponent("file-explorer", () => import("views/explorer"), { componentName: "FileManager" });

                    const explorerEl = document.createElement('ui-file-manager') as FileManager & HTMLElement;

                    // Set up event listeners (extracted from original code)
                    explorerEl.addEventListener('open-item', async (e: any) => {
                        const { item } = e.detail;
                        if (item?.kind === 'file' && item?.file) {
                            await unifiedMessaging.sendMessage({
                                id: crypto.randomUUID(),
                                type: 'content-share',
                                source: 'explorer',
                                destination: 'workcenter',
                                contentType: 'file',
                                data: { file: item.file, filename: item.name, path: explorerEl.path },
                                metadata: { title: item.name, timestamp: Date.now(), source: 'file-explorer' }
                            });
                        }
                    });

                    explorerEl.addEventListener('open', async (e: any) => {
                        const { item } = e.detail;
                        if (item?.kind === 'file' && item?.file) {
                            const isMarkdown = fileHandler.isMarkdownFile(item.file);
                            const destination = isMarkdown ? 'viewer' : 'workcenter';
                            await unifiedMessaging.sendMessage({
                                id: crypto.randomUUID(),
                                type: 'content-share',
                                source: 'explorer',
                                destination,
                                contentType: isMarkdown ? 'markdown' : 'file',
                                data: { file: item.file, filename: item.name, path: explorerEl.path },
                                metadata: { title: item.name, timestamp: Date.now(), source: 'file-explorer' }
                            });
                        }
                    });

                    explorerEl.addEventListener('context-action', async (e: any) => {
                        const { action, item } = e.detail;
                        if (action === 'attach-workcenter' && item?.kind === 'file' && item?.file) {
                            await unifiedMessaging.sendMessage({
                                id: crypto.randomUUID(),
                                type: 'content-share',
                                source: 'explorer',
                                destination: 'workcenter',
                                contentType: 'file',
                                data: { file: item.file, filename: item.name, path: explorerEl.path },
                                metadata: { title: `Attach ${item.name} to Work Center`, timestamp: Date.now(), source: 'file-explorer' }
                            });
                        } else if (action === 'view' && item?.kind === 'file' && item?.file) {
                            const isMarkdown = fileHandler.isMarkdownFile(item.file);
                            const destination = isMarkdown ? 'viewer' : 'workcenter';
                            await unifiedMessaging.sendMessage({
                                id: crypto.randomUUID(),
                                type: 'content-share',
                                source: 'explorer',
                                destination,
                                contentType: isMarkdown ? 'markdown' : 'file',
                                data: { file: item.file, filename: item.name, path: explorerEl.path },
                                metadata: { title: `View ${item.name}`, timestamp: Date.now(), source: 'file-explorer' }
                            });
                        }
                    });

                    // Register component for catch-up messaging
                    registerComponent('file-explorer', 'explorer');

                    // Store reference and initialize with catch-up messaging
                    state.components.explorer.element = explorerEl;

                    // Initialize component with catch-up messaging
                    const pendingMessages = initializeComponent('file-explorer');

                    for (const message of pendingMessages) {
                        const pending = message as any;
                        console.log(`[Explorer] Processing pending message:`, pending);
                        // Process explorer actions directly instead of re-sending through messaging (prevents loops)
                        if (pending.type === 'content-explorer') {
                            const action = pending.data?.action || 'save';
                            const path = pending.data?.path || pending.data?.into || '/';

                            setTimeout(async () => {
                                try {
                                    if (action === 'save' && (pending.data?.file || pending.data?.text || pending.data?.content)) {
                                        let fileToSave: File | null = null;

                                        if (pending.data.file instanceof File) {
                                            fileToSave = pending.data.file;
                                        } else if (pending.data.blob instanceof Blob) {
                                            const filename = pending.data.filename || `file-${Date.now()}`;
                                            fileToSave = new File([pending.data.blob], filename, { type: pending.data.blob.type });
                                        } else if (pending.data.text || pending.data.content) {
                                            const payloadContent = pending.data.text || pending.data.content;
                                            const textContent = typeof payloadContent === 'string' ? payloadContent : JSON.stringify(payloadContent, null, 2);
                                            const filename = pending.data.filename || `content-${Date.now()}.txt`;
                                            fileToSave = new File([textContent], filename, { type: 'text/plain' });
                                        }

                                        if (fileToSave && explorerEl) {
                                            if (path && path !== explorerEl.path) {
                                                explorerEl.path = path;
                                            }
                                            showStatusMessage(`Saved ${fileToSave.name} to Explorer`);
                                        }
                                    } else if (action === 'view' && pending.data?.path) {
                                        if (explorerEl && path) {
                                            explorerEl.path = path;
                                            showStatusMessage(`Opened Explorer at ${path}`);
                                        }
                                    }
                                } catch (error) {
                                    console.warn('[Explorer] Failed to handle pending message:', error);
                                    showStatusMessage("Failed to perform Explorer action");
                                }
                            }, 100);
                        }
                    }

                    content.innerHTML = '';
                    return explorerEl;
                },

                'history': () => renderHistoryView(),
                'markdown-viewer': () => renderMarkdownViewer(),
                'markdown-editor': () => renderMarkdownEditor(),
                'rich-editor': () => renderRichEditor()
            };

            // Get the renderer for current view
            const renderer = viewRenderers[state.view];

            if (renderer) {
                try {
                    const result = await renderer();
                    if (result) {
                        handleComponentSuccess(result);
                    }
                } catch (error) {
                    const componentName = state.view.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase());
                    handleComponentError(componentName, error);
                }
                return;
            }

            if (state.view === "file-picker") {
                // Simple file picker view
                content.innerHTML = `
                <div class="file-picker">
                    <div class="file-picker-header">
                        <h2>Open File</h2>
                        <p>Select a file to open in the viewer or editor</p>
                    </div>
                    <div class="file-picker-actions">
                        <button class="btn btn-primary" data-action="open-markdown" type="button">
                            <ui-icon icon="file-text" size="18" icon-style="duotone"></ui-icon>
                            <span>Open Markdown</span>
                        </button>
                        <button class="btn" data-action="open-any" type="button">
                            <ui-icon icon="file" size="18" icon-style="duotone"></ui-icon>
                            <span>Open Any File</span>
                        </button>
                    </div>
                    <div class="file-picker-info">
                        <p><strong>Markdown files</strong> will open in the viewer/editor</p>
                        <p><strong>Other files</strong> will be processed by the work center</p>
                    </div>
                </div>
            `;

                // Add event listeners for the buttons
                const openMarkdownBtn = content.querySelector('[data-action="open-markdown"]') as HTMLButtonElement;
                const openAnyBtn = content.querySelector('[data-action="open-any"]') as HTMLButtonElement;

                if (openMarkdownBtn) {
                    openMarkdownBtn.addEventListener('click', () => {
                        // Trigger file input for markdown files
                        fileInput.accept = ".md,.markdown,.txt,text/markdown";
                        fileInput.click();
                    });
                }

                if (openAnyBtn) {
                    openAnyBtn.addEventListener('click', () => {
                        // Trigger file input for any files
                        fileInput.accept = "*";
                        fileInput.click();
                    });
                }

                renderStatus();

                return;
            }

            if (state.view === "workcenter") {
                // Lazy load work center
                content.innerHTML = '<div class="component-loading"><div class="loading-spinner"></div><span>Loading Work Center...</span></div>';

                getCachedComponent(
                    'workcenter',
                    () => import("views/workcenter/ts/WorkCenter").then((m) => m.WorkCenterManager),
                    { componentName: 'WorkCenter' }
                ).then(async (workCenterModule) => {
                    // Create work center manager if not already created
                    if (!state.managers.workCenter.instance) {
                        state.managers.workCenter.instance = new workCenterModule.component({
                            state: state,
                            history: state.history,
                            onFilesChanged: () => {
                                // Re-render toolbar to update file count badge
                                renderToolbar();
                            },
                            getSpeechPrompt,
                            showMessage: (message: string) => showStatusMessage(message),
                            render: () => render()
                        });
                    }

                    // Register and initialize component with catch-up messaging
                    if (!state.managers.workCenter.initialized) {
                        state.managers.workCenter.initialized = true;

                        // Register component for catch-up messaging
                        registerComponent('workcenter-manager', 'workcenter');

                        // Initialize component with catch-up messaging
                        const pendingMessages = initializeComponent('workcenter-manager');

                        // Process any pending messages directly in work center logic
                        // Prefer WorkCenter's unified external-message handler so
                        // share-target and content-share message variants are replayed
                        // with the same logic as live messages.
                        for (const message of pendingMessages) {
                            console.log(`[WorkCenter] Processing pending message:`, message);
                            try {
                                if (isAttachmentMessage(message)) {
                                    // eslint-disable-next-line no-await-in-loop
                                    await handleWorkCenterAttachment(message, state, setViewHash, render, showStatusMessage, true);
                                } else if (state.managers.workCenter.instance?.handleExternalMessage) {
                                    // eslint-disable-next-line no-await-in-loop
                                    await state.managers.workCenter.instance.handleExternalMessage(message);
                                } else {
                                    // Legacy fallback for raw attachment packets.
                                    // eslint-disable-next-line no-await-in-loop
                                    await handleWorkCenterAttachment(message, state, setViewHash, render, showStatusMessage, true);
                                }
                            } catch (error) {
                                console.warn('[WorkCenter] Failed to replay pending message:', error);
                            }
                        }
                    }

                    const workCenterElement = state.managers.workCenter.instance.renderWorkCenterView();
                    content.innerHTML = '';
                    content.append(workCenterElement);
                    renderStatus();

                }).catch(error => {
                    console.error('Failed to load work center:', error);
                    content.innerHTML = '<div class="component-error"><h3>Failed to load Work Center</h3><p>Please try refreshing the page.</p></div>';
                    renderStatus();

                });
                return;
            }

            // Default fallback to markdown viewer
            renderMarkdownViewer().then(viewerElement => {
                content.append(viewerElement);
                renderStatus();

            }).catch(error => {
                console.error('Failed to load default markdown viewer:', error);
                content.innerHTML = '<div class="component-error"><h3>Failed to load Markdown Viewer</h3><p>Please try refreshing the page.</p></div>';
                renderStatus();

            });

        } finally {
            isRendering = false;
            // If another render was scheduled during this one, run it now
            if (renderScheduled) {
                setTimeout(() => render(), 0);
            }
        }
    };

    const attachToolbarListeners = () => {
        toolbar.addEventListener("click", async (e) => {
            const target = e.target as HTMLElement | null;
            const btn = target?.closest?.("button[data-action]") as HTMLButtonElement | null;
            const action = btn?.dataset?.action;
            if (!action) return;

            // Handle view changes with hash updates
            let newView: ShellView | null = null;
            if (action === "view-markdown-viewer") newView = "markdown-viewer";
            if (action === "view-markdown-editor") newView = "markdown-editor";
            if (action === "view-rich-editor") newView = "rich-editor";
            if (action === "view-workcenter") newView = "workcenter";
            if (action === "view-settings") newView = "settings";
            if (action === "view-history") newView = "history";
            if (action === "view-file-explorer") newView = "file-explorer";

            if (newView) {
                state.view = newView;
                setViewHash(newView);
            }

            if (action === "open-md") fileInput.click();
            if (action === "save-md") saveToFile();
            if (action === "export-md") exportMarkdown();
            if (action === "export-docx") {
                const md = state.markdown || "";
                if (md.trim()) {
                    const { downloadMarkdownAsDocx } = await import("core/document/DocxExport");
                    await downloadMarkdownAsDocx(md, {
                        title: "CrossWord",
                        filename: `crossword-${Date.now()}.docx`,
                    });
                }
            }

            if (action === "toggle-edit") {
                if (state.view !== "markdown-viewer" && state.view !== "markdown-editor") return;
                state.editing = !state.editing;
            }

            if (action === "snip") {
                if (!ext) return;
                try {
                    chrome.tabs.query({ active: true, lastFocusedWindow: true, currentWindow: true }, (tabs: any[]) => {
                        const tabId = tabs?.[0]?.id;
                        if (tabId != null) {
                            chrome.tabs.sendMessage(tabId, { type: "START_SNIP" })?.catch?.(() => void 0);
                        }
                        try {
                            globalThis?.close?.();
                        } catch {
                            // ignore
                        }
                    });
                } catch {
                    // ignore
                }
            }

            if (action === "process-content") {
                // Use unified messaging to send to work center for processing
                if (state.managers.workCenter.instance) {
                    await unifiedMessaging.sendMessage({
                        id: crypto.randomUUID(),
                        type: 'content-process',
                        source: 'main-app',
                        destination: 'workcenter',
                        data: { prompt: state.markdown || "Process this content" },
                        metadata: {
                            timestamp: Date.now(),
                            correlationId: `main-${Date.now()}`
                        }
                    });
                }
            }

            if (action === "save-to-explorer") {
                // Save work center results to explorer
                if (state.managers.workCenter.instance) {
                    const workCenterState = state.managers.workCenter.instance.getState();
                    const results = workCenterState.results || [];

                    if (results.length > 0) {
                        // Save the latest result to explorer
                        const latestResult = results[results.length - 1];
                        await unifiedMessaging.sendMessage({
                            id: crypto.randomUUID(),
                            type: 'content-save',
                            source: 'main-app',
                            destination: 'explorer',
                            data: {
                                action: 'save',
                                text: typeof latestResult === 'string' ? latestResult : JSON.stringify(latestResult, null, 2),
                                filename: `workcenter-result-${Date.now()}.txt`,
                                path: '/workcenter-results/'
                            },
                            metadata: {
                                title: 'Work Center Result',
                                timestamp: Date.now(),
                                source: 'workcenter'
                            }
                        });
                    } else {
                        state.message = "No results to save";
                        renderStatus();
                        setTimeout(() => {
                            state.message = "";
                            renderStatus();
                        }, 2000);
                    }
                }
            }

            if (action === "solve") {
                await runPrompt("Solve equations and answer questions from the content above", solveAndAnswer);
            }

            if (action === "code") {
                await runPrompt("Generate code based on the description or requirements above", writeCode);
            }

            if (action === "css") {
                await runPrompt("Extract or generate CSS from the content or image above", extractCSS);
            }

            if (action === "voice") {
                void (async () => {
                    const p = await getSpeechPrompt();
                    if (!p) return;
                    await runPrompt(p);
                })();
            }

            void render();
        });
    };

    // Attach initial toolbar listeners
    attachToolbarListeners();

    fileInput.addEventListener("change", () => {
        const f = fileInput.files?.[0];
        if (!f) return;
        void f
            .text()
            .then((text) => {
                state.markdown = text || "";
                persistMarkdown();
                saveLastSrc("");

                // Don't change view if already in markdown-viewer mode
                if (state.view !== "markdown-viewer") {
                    state.view = "markdown-viewer";
                    setViewHash("markdown-viewer");
                }

                state.message = `Loaded ${f.name}`;
                renderStatus();
                void render();

                setTimeout(() => {
                    state.message = "";
                    renderStatus();
                }, 3000);
            })
            .catch(() => void 0)
            .finally(() => {
                fileInput.value = "";
            });
    });

    void loadSettings()
        .then((s) => {
            state.lastSavedTheme = (s?.appearance?.theme as any) || "auto";
            applyTheme(root, state.lastSavedTheme);
        })
        .catch(() => applyTheme(root, "auto" as any));

    // In PWA / regular web app: if the last opened markdown was a URL, try to refresh it.
    // If offline, cached `rs-markdown` will remain.
    //if (!options.initialMarkdown) {
    const lastSrc = loadLastSrc();
    if (lastSrc) {
        void readMdFromUrlIfPossible(lastSrc).then((text) => {
            if (!text) return;
            state.markdown = text;
            persistMarkdown();
            void render();
        });
    }
    //}

    void render();
};

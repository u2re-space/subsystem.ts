export type ViewId = string;
export type ShellId = string;

export interface ShellContext {
    navigate?: (viewId: ViewId, options?: ViewOptions) => void | Promise<void>;
    openView?: (viewId: ViewId, options?: ViewOptions) => void | Promise<void>;
    showMessage?: (message: string, options?: Record<string, unknown>) => void;
    emit?: (type: string, payload?: unknown) => void | Promise<void>;
    [key: string]: unknown;
}

export interface ViewLifecycle {
    onMount?: () => void | Promise<void>;
    onUnmount?: () => void | Promise<void>;
    onShow?: () => void | Promise<void>;
    onHide?: () => void | Promise<void>;
}

export interface ViewOptions {
    id?: ViewId;
    params?: Record<string, unknown>;
    shellContext?: ShellContext;
    container?: HTMLElement;
    [key: string]: unknown;
}

export type BaseViewOptions = ViewOptions;

export interface View {
    id: ViewId;
    name?: string;
    icon?: string;
    lifecycle?: ViewLifecycle;
    render: (options?: ViewOptions) => HTMLElement;
    getToolbar?: () => HTMLElement | null;
    canHandleMessage?: (messageType: string) => boolean;
    handleMessage?: (message: unknown) => void | Promise<void>;
    invokeChannelApi?: (action: string, payload?: unknown) => unknown | Promise<unknown>;
}

export type ViewFactory<TView = View | HTMLElement> = (options?: ViewOptions) => TView;

export type ViewModule = {
    default?: ViewFactory | View | HTMLElement | CustomElementConstructor;
    createView?: ViewFactory;
    createHomeView?: ViewFactory;
    createMarkdownViewer?: ViewFactory;
    createViewerView?: ViewFactory;
    createExplorerView?: ViewFactory;
    createEditorView?: ViewFactory;
    createHistoryView?: ViewFactory;
    createSettingsView?: ViewFactory;
    createWorkCenterView?: ViewFactory;
    createAirpadView?: ViewFactory;
    mountView?: (container: HTMLElement, options?: ViewOptions) => HTMLElement | View | Promise<HTMLElement | View>;
    [key: string]: unknown;
};

export interface ViewStateStore<T> {
    load(): T | null;
    save(next: T): void;
    clear(): void;
}

const safeParse = <T>(raw: string | null): T | null => {
    if (!raw) return null;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
};

export function createViewState<T>(key: string, storage: Storage | null | undefined = globalThis.localStorage): ViewStateStore<T> {
    return {
        load: () => safeParse<T>(storage?.getItem?.(key) ?? null),
        save: (next: T) => {
            storage?.setItem?.(key, JSON.stringify(next));
        },
        clear: () => {
            storage?.removeItem?.(key);
        }
    };
}

function isHTMLElementConstructor(value: unknown): value is CustomElementConstructor {
    if (typeof value !== "function" || typeof HTMLElement === "undefined") return false;
    const proto = (value as { prototype?: unknown }).prototype;
    return Boolean(proto && HTMLElement.prototype.isPrototypeOf(proto as object));
}

function isView(value: unknown): value is View {
    return Boolean(value && typeof value === "object" && typeof (value as View).render === "function");
}

function isElement(value: unknown): value is HTMLElement {
    return typeof HTMLElement !== "undefined" && value instanceof HTMLElement;
}

export function createViewFromModule(module: ViewModule, options: ViewOptions = {}): View | HTMLElement {
    const candidates = [
        module.createView,
        module.createHomeView,
        module.createMarkdownViewer,
        module.createViewerView,
        module.createExplorerView,
        module.createEditorView,
        module.createHistoryView,
        module.createSettingsView,
        module.createWorkCenterView,
        module.createAirpadView,
        module.default
    ];

    for (const candidate of candidates) {
        if (!candidate) continue;
        if (isView(candidate) || isElement(candidate)) return candidate;
        if (isHTMLElementConstructor(candidate)) return new candidate();
        if (typeof candidate === "function") {
            return (candidate as ViewFactory)(options);
        }
    }

    throw new Error("View module must export default/createView or a named create*View factory");
}

export function renderViewInstance(view: View | HTMLElement, options: ViewOptions = {}): HTMLElement {
    // Custom-element views (explorer, markdown, …) extend HTMLElement and expose `.render()` that
    // returns the light-DOM subtree to mount — not `this`. Prefer calling it when present.
    if (typeof HTMLElement !== "undefined" && view instanceof HTMLElement) {
        const el = view as HTMLElement & Partial<Pick<View, "render">>;
        if (typeof el.render === "function") {
            const out = el.render(options) as unknown;
            if (out instanceof HTMLElement) return out;
        }
        return view;
    }
    if (isView(view)) return view.render(options);
    throw new Error("renderViewInstance: unsupported view");
}

export interface MountedView {
    view: View | HTMLElement;
    element: HTMLElement;
    unmount(): Promise<void>;
}

export async function mountViewModule(
    container: HTMLElement,
    module: ViewModule,
    options: ViewOptions = {}
): Promise<MountedView> {
    if (module.mountView) {
        const mounted = await module.mountView(container, options);
        const element = isElement(mounted) ? mounted : renderViewInstance(mounted, options);
        if (!container.contains(element)) container.replaceChildren(element);
        return {
            view: mounted,
            element,
            unmount: async () => {
                if (isView(mounted)) await mounted.lifecycle?.onUnmount?.();
                element.remove();
            }
        };
    }

    const view = createViewFromModule(module, { ...options, container });
    const element = renderViewInstance(view, { ...options, container });
    container.replaceChildren(element);
    if (isView(view)) {
        await view.lifecycle?.onMount?.();
        await view.lifecycle?.onShow?.();
    }

    return {
        view,
        element,
        unmount: async () => {
            if (isView(view)) {
                await view.lifecycle?.onHide?.();
                await view.lifecycle?.onUnmount?.();
            }
            element.remove();
        }
    };
}

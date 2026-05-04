import { UUIDv4 } from "fest/core";
import { UIElement } from "fest/fl-ui";
import { defineElement, type CustomElementLifecycle, type GLitElementConstructor } from "fest/lure";

/** Registered custom element constructors produced through `createViewConstructor` / `extendViewConstructor`. */
export const registeredViewConstructors = new Map<string, CustomElementConstructor>();

//
export interface ViewMetaData {
    viewVersion?: string;
    viewAuthor?: string;
    viewLicense?: string;
    viewCopyright?: string;
    viewDescription?: string;
    viewKeywords?: string[];
}

//
export const currentViewMap = new Map<string, ViewInstance>();
export interface ViewOptions {
    initializator?: (element: ViewInstance, options: ViewOptions) => void;
    viewName?: string;
    viewId?: string;
    viewType?: string;
    viewIcon?: string;
    viewMetaData?: ViewMetaData;
}

//
export interface ViewLifecycle {
    onInitialize?: (this: ViewInstance) => void;
    onMount?: () => void;
    onUnmount?: () => void;
    onShow?: () => void;
    onHide?: () => void;
    options?: ViewOptions;
}

//
export type ViewInstance = HTMLElement & UIElement & CustomElementLifecycle & ViewLifecycle;
export interface ConstructorOptions {
    /** Built-in element tag when extending native elements (`CustomElementRegistry.define` third argument). */
    extends?: string;
    rendering?: (this: ViewInstance, ...args: any[]) => any;
    initialization?: (this: ViewInstance, ...args: any[]) => any;
    render?: (this: ViewInstance, ...args: any[]) => any;
    styles?: (this: ViewInstance, ...args: any[]) => any;
    lifecycle?: ViewLifecycle;
}

/** Merge additive `ConstructorOptions` (later wins on overlapping shallow keys except lifecycle hooks chain). */
export function mergeConstructorOptions(
    base: ConstructorOptions | undefined | null,
    extra: ConstructorOptions | undefined | null
): ConstructorOptions {
    const a = base ?? {};
    const b = extra ?? {};
    return {
        ...a,
        ...b,
        lifecycle: { ...a.lifecycle, ...b.lifecycle }
    };
}

function extendPrototypeMethod(proto: object, key: string | symbol, extension: (...args: any[]) => unknown): void {
    const desc = Object.getOwnPropertyDescriptor(proto, key);
    const old = desc?.value as ((...args: any[]) => unknown) | undefined;
    Object.defineProperty(proto, key, {
        configurable: true,
        enumerable: desc?.enumerable ?? true,
        writable: true,
        value: function (this: unknown, ...args: any[]) {
            const prev = old?.apply(this, args);
            const next = extension.apply(this, args);
            return next !== undefined ? next : prev ?? this;
        }
    });
}

function mergeLifecycle(proto: ViewInstance, lifecycle: ViewLifecycle): void {
    const hookKeys = ["onInitialize", "onMount", "onUnmount", "onShow", "onHide"] as const;
    for (const k of hookKeys) {
        const fn = lifecycle[k];
        if (typeof fn === "function") extendPrototypeMethod(proto, k, fn as (...args: any[]) => unknown);
    }
}

/** Apply declarative patches after the class exists (chains with any existing prototype implementation). */
export function applyConstructorOptions(Ctor: GLitElementConstructor<ViewBase>, opts: ConstructorOptions): void {
    const proto = Ctor.prototype as ViewInstance;
    if (opts.initialization) extendPrototypeMethod(proto, "onInitialize", opts.initialization as (...args: any[]) => unknown);
    if (opts.rendering) extendPrototypeMethod(proto, "onRender", opts.rendering as (...args: any[]) => unknown);
    if (opts.render) extendPrototypeMethod(proto, "render", opts.render as (...args: any[]) => unknown);
    if (opts.styles) extendPrototypeMethod(proto, "styles", opts.styles as (...args: any[]) => unknown);
    if (opts.lifecycle) mergeLifecycle(proto, opts.lifecycle);
}

//
@defineElement("cw-view-base")
export class ViewBase extends UIElement implements ViewInstance {
    protected __options: ViewOptions;
    protected __initialized = false;

    /** Per-element broadcast surface for intra-view messaging (slots, decorators, tooling). Separate from CWSP routing. */
    private __viewChannel: EventTarget | null = null;

    set options(value: ViewOptions) {
        this.__options = value;
    }
    get options(): ViewOptions {
        return this.__options;
    }

    get viewChannel(): EventTarget {
        if (!this.__viewChannel) this.__viewChannel = new EventTarget();
        return this.__viewChannel;
    }

    dispatchViewChannel(type: string, detail?: unknown, init?: CustomEventInit): boolean {
        return this.viewChannel.dispatchEvent(new CustomEvent(type, { ...init, detail }));
    }

    subscribeViewChannel(type: string, listener: EventListener): () => void {
        const bus = this.viewChannel;
        bus.addEventListener(type, listener);
        return () => bus.removeEventListener(type, listener);
    }

    viewInitialize(this: ViewInstance): this {
        const opts = this.options;
        opts?.initializator?.call?.(this, this, opts);
        return this as this;
    }

    constructor() {
        super();
    }

    onInitialize(this: ViewInstance): this {
        super.onInitialize?.call?.(this);
        (this as any)?.viewInitialize?.call?.(this);
        return this as this;
    }
}

/** Chain `extension` after any existing prototype method (same semantics as `applyConstructorOptions`). */
export const extendFunction = <T extends (...args: any[]) => unknown>(
    proto: object,
    name: string | symbol,
    extension: T
): T => {
    extendPrototypeMethod(proto, name, extension as (...args: any[]) => unknown);
    return (proto as any)[name];
};

//
export type ConstructorCallback<T extends ViewBase = ViewBase> = (
    base: typeof ViewBase
) => GLitElementConstructor<T>;

//
export const createViewConstructor = <T extends ViewBase = ViewBase>(
    elementName: string,
    options: ConstructorOptions | ConstructorCallback<T>,
    extension?: ConstructorOptions | undefined | null
): GLitElementConstructor<T> => {
    const patch: ConstructorOptions =
        typeof options === "function"
            ? extension ?? {}
            : mergeConstructorOptions(options as ConstructorOptions, extension ?? {});

    const definitionOpts = patch.extends ? { extends: patch.extends } : undefined;

    let Ctor: GLitElementConstructor<T>;
    if (typeof options === "function") {
        Ctor = options(ViewBase as any) as GLitElementConstructor<T>;
    } else {
        class GeneratedView extends ViewBase {
            constructor() {
                super();
            }
        }
        Ctor = GeneratedView as unknown as GLitElementConstructor<T>;
    }

    defineElement(elementName, definitionOpts)(Ctor as any);
    applyConstructorOptions(Ctor as GLitElementConstructor<ViewBase>, patch);
    registeredViewConstructors.set(elementName, Ctor as unknown as CustomElementConstructor);

    return Ctor;
};

/** Register a new tag that subclasses an existing view constructor and applies extra patches. */
export function extendViewConstructor<T extends ViewBase>(
    elementName: string,
    BaseCtor: GLitElementConstructor<T>,
    extra: ConstructorOptions,
    definition?: ElementDefinitionOptions
): GLitElementConstructor<T> {
    class Extended extends (BaseCtor as unknown as typeof ViewBase) {}
    defineElement(elementName, definition)(Extended as any);
    applyConstructorOptions(Extended as GLitElementConstructor<ViewBase>, extra);
    registeredViewConstructors.set(elementName, Extended as unknown as CustomElementConstructor);
    return Extended as unknown as GLitElementConstructor<T>;
}

export type CreateViewTaskOptions = ViewOptions & {
    /** Cache key for singleton instances in `currentViewMap`. Defaults to `options.viewName` or a new UUID. */
    reuseKey?: string;
    /** When false, always instantiate a fresh element (not cached). Default true when using the map. */
    singleton?: boolean;
};

/** Acquire or create a view element instance; supports singleton pooling keyed by `reuseKey` / `viewName`. */
export const createView = <T extends ViewInstance>(
    elementName: string,
    options: ViewOptions = {},
    taskOrKey?: string | CreateViewTaskOptions
): T => {
    const task: CreateViewTaskOptions =
        typeof taskOrKey === "string"
            ? { reuseKey: taskOrKey, singleton: true }
            : { singleton: true, ...taskOrKey };

    const key = task.reuseKey ?? options.viewName ?? UUIDv4();
    const { singleton, reuseKey: _rk, ...taskViewOptions } = task;
    const resolvedOptions: ViewOptions = { ...options, ...taskViewOptions };

    if (singleton === false) {
        const element = document.createElement(elementName) as T;
        element.options = resolvedOptions;
        return element;
    }

    //@ts-ignore Map.prototype.getOrInsertComputed polyfill (fl.ui / index.html)
    return currentViewMap.getOrInsertComputed(key, () => {
        const element = document.createElement(elementName) as T;
        element.options = resolvedOptions;
        return element;
    }) as T;
};

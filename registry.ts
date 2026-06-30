import type { View, ViewLifecycle, ViewOptions } from "./types";

export class ViewBase extends HTMLElement implements View {
    id = "view";
    name = "View";
    icon = "square";
    options: ViewOptions = {};
    lifecycle: ViewLifecycle = {};

    constructor(options?: ViewOptions) {
        super();
        if (options) this.options = options;
    }

    render(options?: ViewOptions): HTMLElement {
        if (options) this.options = { ...this.options, ...options };
        return this;
    }
}

export function createViewConstructor<T extends CustomElementConstructor>(
    tagName: string,
    build: (Base: typeof ViewBase) => T
): T {
    const existing = globalThis.customElements?.get?.(tagName);
    if (existing) return existing as T;

    const Ctor = build(ViewBase);
    globalThis.customElements?.define?.(tagName, Ctor);
    return Ctor;
}

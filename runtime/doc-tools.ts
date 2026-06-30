export function eventTargetElement(ev: Event): HTMLElement | null {
    const target = ev.target;
    if (target instanceof HTMLElement) return target;
    if (target instanceof Node && target.parentElement) return target.parentElement;
    for (const item of ev.composedPath?.() ?? []) {
        if (item instanceof HTMLElement) return item;
    }
    return null;
}

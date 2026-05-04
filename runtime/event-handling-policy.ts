export function stopBubbling(ev: Event): void {
    ev.stopPropagation();
}

export function waitForDomPaint(): Promise<void> {
    return new Promise((resolve) => {
        globalThis.requestAnimationFrame?.(() => resolve()) ?? setTimeout(resolve, 0);
    });
}

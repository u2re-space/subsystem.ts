export type SpeedDialItem = {
    label?: string;
    href?: string;
    icon?: string;
    action?: string;
    cell?: [number, number];
    [key: string]: unknown;
};

export const speedDialItems: SpeedDialItem[] = [];

export function createEmptySpeedDialItem(): SpeedDialItem {
    return { label: "", href: "", cell: [0, 0] };
}

export function ensureSpeedDialMeta(item: SpeedDialItem): SpeedDialItem {
    item.cell ??= [0, 0];
    return item;
}

export function addSpeedDialItem(item: SpeedDialItem): void {
    speedDialItems.push(ensureSpeedDialMeta(item));
}

export function persistSpeedDialItems(): void {
    globalThis.localStorage?.setItem("view-speed-dial-items", JSON.stringify(speedDialItems));
}

export function persistSpeedDialMeta(): void {
    persistSpeedDialItems();
}

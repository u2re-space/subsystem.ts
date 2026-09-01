/*
 * Filename: sku-ports.ts
 * FullPath: modules/projects/subsystem/src/routing/api/sku-ports.ts
 * FIND:sku-ports
 * TAG:process,layers
 * Change date: 19.30.00_01.09.2026
 * Reason: SKU fleet /ws and ssre listen off core :8434.
 *
 * INVARIANT: :8434 is CWSP core / Control / Java / Neutralino only.
 * INVARIANT: SKU fleet starts at 8436; ssre sse/ssw starts at 8455.
 */

export const CWSP_CORE_FLEET_PORT = 8434;

export type SkuChannelId = "process" | "shell" | "explorer" | "document";

export type SkuChannelPorts = {
    id: SkuChannelId;
    fleetWs: number;
    ssre: number;
};

/** Reserved SKU sockets. This pass only Process listens. */
export const SKU_CHANNEL_PORTS: Record<SkuChannelId, SkuChannelPorts> = {
    process: { id: "process", fleetWs: 8436, ssre: 8455 },
    shell: { id: "shell", fleetWs: 8437, ssre: 8456 },
    explorer: { id: "explorer", fleetWs: 8438, ssre: 8457 },
    document: { id: "document", fleetWs: 8439, ssre: 8458 }
};

export const skuChannelPorts = (id: SkuChannelId = "process"): SkuChannelPorts =>
    SKU_CHANNEL_PORTS[id];

export const isCwspCoreFleetPort = (port: number): boolean => Number(port) === CWSP_CORE_FLEET_PORT;

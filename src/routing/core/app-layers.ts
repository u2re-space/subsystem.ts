/**
 * App shell / canvas / overlay stacking under #app (or another mount root).
 * Implemented here (under `shared/routing`) so PWA and CRX entries resolve one stable
 * module — avoids dev-server secondary fetches to `frontend/ai-slop/*` that could fail behind proxies.
 */
import { fixOrientToScreen } from "fest/dom";
import { initializeAppCanvasLayer } from "../../../../../../modules/projects/image.ts/src/canvas/Canvas-2";

/** COMPAT: historical `fl-ui/speed-dial` orient hook; upstream module not present in this tree. */
const initializeOrientedDesktop = (_host: HTMLElement): void => {};

export type AppLayers = {
    canvasLayer: HTMLElement | null;
    orientLayer: HTMLElement | null;
    shellLayer: HTMLElement;
    overlayLayer: HTMLElement;
};

export const ensureAppLayers = (
    mountElement: HTMLElement,
    options: { enableOrientLayer?: boolean; enableCanvasLayer?: boolean } = {},
): AppLayers => {
    const enableOrientLayer = options.enableOrientLayer !== false;
    const enableCanvasLayer = options.enableCanvasLayer !== false;
    const existingCanvas = mountElement.querySelector<HTMLElement>('[data-app-layer="canvas"]');
    const existingOrient = mountElement.querySelector<HTMLElement>('[data-app-layer="orient"]');
    const existingShell = mountElement.querySelector<HTMLElement>('[data-app-layer="shell"]');
    const existingOverlay = mountElement.querySelector<HTMLElement>('[data-app-layer="overlay"]');

    const createCanvasLayer = (): HTMLElement => {
        const canvasLayer = document.createElement("div");
        canvasLayer.dataset.appLayer = "canvas";
        canvasLayer.className = "app-layer app-layer--canvas";
        canvasLayer.style.position = "absolute";
        canvasLayer.style.inset = "0";
        canvasLayer.style.zIndex = "0";
        canvasLayer.style.pointerEvents = "none";
        initializeAppCanvasLayer(canvasLayer);
        return canvasLayer;
    };

    if (existingShell && existingOverlay) {
        let canvasLayer: HTMLElement | null = existingCanvas;
        if (enableCanvasLayer && !canvasLayer) {
            canvasLayer = createCanvasLayer();
            mountElement.insertBefore(canvasLayer, existingOrient ?? existingShell);
        }
        if (!enableCanvasLayer && canvasLayer) {
            canvasLayer.remove();
            canvasLayer = null;
        }

        if (enableOrientLayer && !existingOrient) {
            const orientLayer = document.createElement("div");
            orientLayer.dataset.appLayer = "orient";
            orientLayer.className = "app-layer app-layer--orient";
            orientLayer.style.position = "absolute";
            orientLayer.style.inset = "0";
            orientLayer.style.zIndex = "5";
            orientLayer.style.pointerEvents = "none";
            orientLayer.style.background = "transparent";
            const orientBox = document.createElement("cw-oriented-box");
            orientBox.className = "ui-orientbox app-oriented-box";
            orientBox.setAttribute("data-mixin", "ui-orientbox");
            (orientBox as HTMLElement).style.position = "absolute";
            (orientBox as HTMLElement).style.inset = "0";
            (orientBox as HTMLElement).style.pointerEvents = "auto";
            (orientBox as HTMLElement).style.background = "transparent";
            orientLayer.appendChild(orientBox);
            fixOrientToScreen(orientBox as any);
            initializeOrientedDesktop(orientBox as HTMLElement);
            mountElement.insertBefore(orientLayer, existingShell);
            return { canvasLayer, orientLayer, shellLayer: existingShell, overlayLayer: existingOverlay };
        }
        if (!enableOrientLayer && existingOrient) {
            existingOrient.remove();
            return { canvasLayer, orientLayer: null, shellLayer: existingShell, overlayLayer: existingOverlay };
        }
        return {
            canvasLayer,
            orientLayer: enableOrientLayer ? (existingOrient || null) : null,
            shellLayer: existingShell,
            overlayLayer: existingOverlay,
        };
    }

    mountElement.replaceChildren();
    mountElement.style.position = "relative";
    mountElement.style.overflow = "hidden";
    mountElement.dataset.appLayerRoot = "true";

    const canvasLayer = enableCanvasLayer ? createCanvasLayer() : null;

    const orientLayer = enableOrientLayer ? document.createElement("div") : null;
    if (orientLayer) {
        orientLayer.dataset.appLayer = "orient";
        orientLayer.className = "app-layer app-layer--orient";
        orientLayer.style.position = "absolute";
        orientLayer.style.inset = "0";
        orientLayer.style.zIndex = "5";
        orientLayer.style.pointerEvents = "none";
        orientLayer.style.background = "transparent";

        const orientBox = document.createElement("cw-oriented-box");
        orientBox.className = "ui-orientbox app-oriented-box";
        orientBox.setAttribute("data-mixin", "ui-orientbox");
        (orientBox as HTMLElement).style.position = "absolute";
        (orientBox as HTMLElement).style.inset = "0";
        (orientBox as HTMLElement).style.pointerEvents = "auto";
        (orientBox as HTMLElement).style.background = "transparent";
        orientLayer.appendChild(orientBox);
        fixOrientToScreen(orientBox as any);
        initializeOrientedDesktop(orientBox as HTMLElement);
    }

    const shellLayer = document.createElement("div");
    shellLayer.dataset.appLayer = "shell";
    shellLayer.className = "app-layer app-layer--shell";
    shellLayer.style.position = "absolute";
    shellLayer.style.inset = "0";
    shellLayer.style.zIndex = "10";
    shellLayer.style.pointerEvents = "none";
    shellLayer.style.display = "grid";
    shellLayer.style.gridTemplateColumns = "[content-column] minmax(0px, 1fr)";
    shellLayer.style.gridTemplateRows =
        "[status-row] minmax(0px, max-content) [content-row] minmax(0px, 1fr) [dock-row] minmax(0px, max-content)";
    shellLayer.style.overflow = "hidden";
    shellLayer.style.background = "transparent";
    shellLayer.style.backgroundColor = "transparent";

    const overlayLayer = document.createElement("div");
    overlayLayer.dataset.appLayer = "overlay";
    overlayLayer.className = "app-layer app-layer--overlay";
    overlayLayer.style.position = "absolute";
    overlayLayer.style.inset = "0";
    overlayLayer.style.zIndex = "1000";
    overlayLayer.style.pointerEvents = "none";
    overlayLayer.style.background = "transparent";
    overlayLayer.style.backgroundColor = "transparent";

    if (canvasLayer) {
        mountElement.append(canvasLayer);
    }
    if (orientLayer) {
        mountElement.append(orientLayer);
    }
    mountElement.append(shellLayer, overlayLayer);

    return { canvasLayer, orientLayer, shellLayer, overlayLayer };
};

import * as viewModule from "view-entry";
import { mountViewModule, type ShellContext, type ViewModule } from "../types";

declare const __VIEW_PROJECT_NAME__: string;

const app = document.querySelector<HTMLElement>("#app") ?? document.body;
const status = document.querySelector<HTMLElement>("[data-demo-status]");

const shellContext: ShellContext = {
    navigate: (viewId, options) => {
        globalThis.dispatchEvent(new CustomEvent("view:demo:navigate", { detail: { viewId, options } }));
        if (status) status.textContent = `navigate: ${viewId}`;
    },
    showMessage: (message) => {
        if (status) status.textContent = message;
    }
};

mountViewModule(app, viewModule as ViewModule, {
    id: __VIEW_PROJECT_NAME__,
    shellContext
}).catch((error) => {
    console.error(error);
    app.textContent = error instanceof Error ? error.message : String(error);
});

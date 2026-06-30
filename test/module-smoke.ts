import * as viewModule from "view-entry";
import { createViewFromModule, renderViewInstance, type ViewModule } from "../types";

declare const __VIEW_PROJECT_NAME__: string;

const moduleUnderTest = viewModule as ViewModule;

if (!moduleUnderTest.default && !moduleUnderTest.createView) {
    throw new Error(`${__VIEW_PROJECT_NAME__} must export default or createView`);
}

if (typeof document !== "undefined") {
    const view = createViewFromModule(moduleUnderTest, { id: __VIEW_PROJECT_NAME__ });
    const element = renderViewInstance(view, { id: __VIEW_PROJECT_NAME__ });
    if (!(element instanceof HTMLElement)) {
        throw new Error(`${__VIEW_PROJECT_NAME__} did not render an HTMLElement`);
    }
}

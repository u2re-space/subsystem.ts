import { loadSettings } from "com/config/Settings";
import { startTracking } from "core/workers/GeoLocation";

//
export const loadPlanSource = async (): Promise<string | null> => {
    try {
        const stored = await loadSettings();
        return stored?.timeline?.source || null;
    } catch (e) {
        console.warn(e);
        return null;
    }
};

//
export const generateNewPlan = async (speechPrompt: string | null = null) => {
    const settings = await loadSettings();
    if (!settings || !settings?.ai || !settings.ai?.apiKey) return;

    //
    try {
        startTracking?.()?.catch?.(console.warn.bind(console));
    } catch (e) {
        console.warn(e);
    }

    //
    try {
        let source = await loadPlanSource();
        const timelineForm = new FormData();
        timelineForm.append("source", source || "");
        timelineForm.append("text", speechPrompt?.trim?.() || "");

        //
        return fetch("/make-timeline", {
            method: "POST",
            priority: 'auto',
            keepalive: true,
            body: timelineForm,
        })?.catch?.(console.warn.bind(console));
    } catch (e) {
        console.warn(e);
    }
};

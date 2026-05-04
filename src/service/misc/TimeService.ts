import { observe } from "./cache-reactivity";
import { checkInTimeRange, getComparableTimeValue, parseDateCorrectly } from "core/time";

//
export const TimeState: any = observe<{ currentTime: Date, timestamp: number }>({
    currentTime: new Date(),
    timestamp: Date.now()
});

//
let timerId: any = null;
const trackedEvents = new Map<string, { title: string, begin: number, notified: boolean }>();

//
export const startTimeTracking = () => {
    if (timerId) return;

    const update = () => {
        const now = new Date();
        const nowTs = now.getTime();
        TimeState.currentTime = now;
        TimeState.timestamp = nowTs;

        // Check notifications
        if (Notification.permission === "granted") {
            for (const [id, event] of trackedEvents) {
                if (event.notified) continue;

                // Notify if event starts within 15 minutes or has started within last 5 minutes
                const diff = event.begin - nowTs;
                const isUpcoming = diff > 0 && diff <= 15 * 60 * 1000;
                const isStarted = diff <= 0 && diff >= -5 * 60 * 1000;

                if (isUpcoming || isStarted) {
                    sendNotification(event.title, {
                        body: isStarted ? "Event is happening now!" : `Event starts in ${Math.ceil(diff / 60000)} minutes.`,
                        icon: "/assets/icons/icon-192x192.png",
                        tag: id // Prevent duplicate notifications for same event
                    });
                    event.notified = true;
                } else if (diff < -60 * 60 * 1000) {
                    // Cleanup old events (1 hour past)
                    trackedEvents.delete(id);
                }
            }
        }
    };

    update();
    timerId = setInterval(update, 1000 * 30); // Update every 30 seconds
};

//
export const stopTimeTracking = () => {
    if (timerId) {
        clearInterval(timerId);
        timerId = null;
    }
};

//
export const isNow = (beginTime: any, endTime: any) => {
    const now = TimeState.currentTime;
    const begin = parseDateCorrectly(beginTime);
    const end = parseDateCorrectly(endTime);

    if (!begin) return false;

    // If end time is not provided, assume a default duration (e.g., 1 hour) or point in time
    if (!end) {
        // Check if within +/- 15 minutes of begin time
        const diff = Math.abs(getComparableTimeValue(now) - getComparableTimeValue(begin));
        return diff <= 15 * 60 * 1000;
    }

    return checkInTimeRange(begin, end, now);
};

// Notification Logic
export const requestNotificationPermission = async () => {
    const NotificationCtor = (globalThis as any)?.Notification as (typeof Notification | undefined);
    if (!NotificationCtor) return false;
    if (NotificationCtor.permission === "granted") return true;
    if (NotificationCtor.permission !== "denied") {
        const permission = await NotificationCtor.requestPermission();
        return permission === "granted";
    }
    return false;
};

export const sendNotification = (title: string, options?: NotificationOptions) => {
    const NotificationCtor = (globalThis as any)?.Notification as (typeof Notification | undefined);
    if (NotificationCtor?.permission === "granted") {
        const sw = (globalThis as any)?.navigator?.serviceWorker;
        if (sw?.getRegistration) {
            sw.getRegistration().then((reg: ServiceWorkerRegistration | undefined) => {
                if (reg) {
                    reg.showNotification(title, options);
                } else {
                    new NotificationCtor(title, options);
                }
            });
            return;
        }
        try {
            new NotificationCtor(title, options);
        } catch {
            // ignore in restricted contexts
        }
    }
};

export const registerEventForNotification = (id: string, title: string, beginTime: any) => {
    const begin = getComparableTimeValue(beginTime);
    if (!begin || isNaN(begin)) return;

    // If already tracked and start time hasn't changed significantly, skip
    if (trackedEvents.has(id)) {
        const existing = trackedEvents.get(id);
        if (existing && Math.abs(existing.begin - begin) < 1000) return;
    }

    trackedEvents.set(id, {
        title,
        begin,
        notified: false
    });
};

export const unregisterEventForNotification = (id: string) => {
    trackedEvents.delete(id);
};

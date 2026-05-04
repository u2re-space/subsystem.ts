import { observe } from "./cache-reactivity";

//
export const GeoState: any = observe<{ latitude: number | null, longitude: number | null, accuracy: number | null, error: string | null, isAvailable: boolean }>({
    latitude: null as number | null,
    longitude: null as number | null,
    accuracy: null as number | null,
    error: null as string | null,
    isAvailable: typeof navigator !== "undefined" && "geolocation" in navigator
});

//
let watchId: number | null = null;

//
export const startGeoTracking = () => {
    if (!GeoState.isAvailable) {
        GeoState.error = "Geolocation is not available";
        return;
    }

    if (watchId !== null) return;

    watchId = navigator.geolocation.watchPosition(
        (position) => {
            GeoState.latitude = position.coords.latitude;
            GeoState.longitude = position.coords.longitude;
            GeoState.accuracy = position.coords.accuracy;
            GeoState.error = null;
        },
        (error) => {
            GeoState.error = error.message;
        },
        {
            enableHighAccuracy: true,
            maximumAge: 30000,
            timeout: 27000
        }
    );
};

//
export const stopGeoTracking = () => {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
};

// Haversine formula
export const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI / 180; // φ, λ in radians
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // in metres
};

//
export const isNearby = (targetLat: number, targetLon: number, thresholdMeters: number = 500) => {
    if (GeoState.latitude === null || GeoState.longitude === null) return false;
    return getDistance(GeoState.latitude, GeoState.longitude, targetLat, targetLon) <= thresholdMeters;
};

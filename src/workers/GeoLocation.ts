//
const broadcastChannel = new BroadcastChannel('geolocation');
const broadcast = (coords: GeolocationPosition) => {
    //navigator.sendBeacon('/api/geo', JSOX.stringify(coords));
    broadcastChannel.postMessage({
        timestamp: coords?.timestamp || Date.now(),
        coords: coords?.toJSON?.() || "{}"
    });
}

//
export let watchId: number | null = null;
export const startTracking = async () => {
    if (!('geolocation' in navigator)) return;
    watchId = navigator?.geolocation?.watchPosition?.(
        pos => broadcast(pos),
        err => console.error(err),
        { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 }
    );
    return getGeolocation();
}

//
export const stopTracking = async () => {
    if (watchId) navigator?.geolocation?.clearWatch?.(watchId);
    broadcastChannel.postMessage({ type: 'stop' });
    return getGeolocation();
}

//
broadcastChannel.addEventListener('message', (e) => {
    if (e.data.type === 'start') {
        startTracking?.()?.catch?.(console.warn.bind(console));
    } else if (e.data.type === 'stop') {
        stopTracking?.()?.catch?.(console.warn.bind(console));
    }
});

//
export const getGeolocation = async () => {
    const location = new Promise<GeolocationPosition>((resolve, reject) => navigator?.geolocation?.getCurrentPosition?.(resolve, reject));
    location?.then?.(broadcast)?.catch?.(console.warn.bind(console));
    return location;
}

/*
* Local Storage
* Data Storage based on browser's Local Storage API
* Has data limitations for 5MB per domain
* https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage
* https://developer.mozilla.org/en-US/docs/Web/API/Storage
* https://developer.mozilla.org/en-US/docs/Web/API/Storage/getItem
* https://developer.mozilla.org/en-US/docs/Web/API/Storage/setItem
* https://developer.mozilla.org/en-US/docs/Web/API/Storage/removeItem
* https://developer.mozilla.org/en-US/docs/Web/API/Storage/clear
* https://developer.mozilla.org/en-US/docs/Web/API/Storage/key
* https://developer.mozilla.org/en-US/docs/Web/API/Storage/length
* https://developer.mozilla.org/en-US/docs/Web/API/Storage/getItem
*/

//
export class LocalStorage {
    //
    constructor() {
        //
    }

    //
    async get(key: string) {
        return localStorage.getItem(key);
    }

    //
    async set(key: string, value: any) {
        localStorage.setItem(key, value);
    }

    //
    async delete(key: string) {
        localStorage.removeItem(key);
    }

    //
    async clear() {
        localStorage.clear();
    }
}

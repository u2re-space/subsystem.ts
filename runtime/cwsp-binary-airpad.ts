/**
 * Legacy 8-byte AirPad binary frames (parity with Java {@code CwspBinaryAirpad} and endpoint {@code message.ts}).
 */
import { encodeInputPerfTsLo, decodeInputPerfTsLo } from "./input-command-timing.ts";
export const MSG_TYPE_MOVE = 0;
export const MSG_TYPE_CLICK = 1;
export const MSG_TYPE_SCROLL = 2;
export const MSG_TYPE_MOUSE_DOWN = 3;
export const MSG_TYPE_MOUSE_UP = 4;
export const MSG_TYPE_KEYBOARD = 6;

export const BUTTON_LEFT = 0;
export const BUTTON_RIGHT = 1;
export const BUTTON_MIDDLE = 2;
export const FLAG_DOUBLE = 0x80;

const buttonNum = (button?: string): number => {
    const b = String(button || "left").toLowerCase();
    if (b === "right") return BUTTON_RIGHT;
    if (b === "middle") return BUTTON_MIDDLE;
    return BUTTON_LEFT;
};

export const encodeBinaryMouse = (
    type: number,
    dx: number,
    dy: number,
    flags = 0
): ArrayBuffer => {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setInt16(0, Math.round(dx), true);
    view.setInt16(2, Math.round(dy), true);
    view.setUint8(4, type);
    view.setUint8(5, flags);
    view.setUint16(6, encodeInputPerfTsLo(), true);
    return buffer;
};

export const encodeBinaryMove = (dx: number, dy: number): ArrayBuffer =>
    encodeBinaryMouse(MSG_TYPE_MOVE, dx, dy, 0);

export const encodeBinaryScroll = (dx: number, dy: number): ArrayBuffer =>
    encodeBinaryMouse(MSG_TYPE_SCROLL, dx, dy, 0);

export const encodeBinaryClick = (button?: string, double = false): ArrayBuffer =>
    encodeBinaryMouse(MSG_TYPE_CLICK, 0, 0, buttonNum(button) | (double ? FLAG_DOUBLE : 0));

export const encodeBinaryMouseDown = (button?: string): ArrayBuffer =>
    encodeBinaryMouse(MSG_TYPE_MOUSE_DOWN, 0, 0, buttonNum(button));

export const encodeBinaryMouseUp = (button?: string): ArrayBuffer =>
    encodeBinaryMouse(MSG_TYPE_MOUSE_UP, 0, 0, buttonNum(button));

export const encodeBinaryKeyboard = (codePoint: number, flags = 0): ArrayBuffer => {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setUint32(0, codePoint >>> 0, true);
    view.setUint8(4, MSG_TYPE_KEYBOARD);
    view.setUint8(5, flags);
    view.setUint16(6, encodeInputPerfTsLo(), true);
    return buffer;
};

const timingPayload = (perfTsLo: number): Record<string, number> => {
    if (!perfTsLo) return {};
    return { perfTsLo, perfTs: decodeInputPerfTsLo(perfTsLo) };
};

/** Decode legacy 8-byte frame → JSON coordinator act (routed / gateway sessions). */
export const decodeBinaryAirpadIntent = (
    buffer: ArrayBuffer | Uint8Array
): { what: string; payload: Record<string, unknown> } | null => {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.byteLength < 6) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const type = view.getUint8(4);
    const perfTsLo = bytes.byteLength >= 8 ? view.getUint16(6, true) : 0;
    const timing = timingPayload(perfTsLo);
    if (type === MSG_TYPE_KEYBOARD) {
        const codePoint = view.getUint32(0, true);
        const flags = view.getUint8(5);
        switch (flags) {
            case 1:
                return { what: "keyboard:tap", payload: { key: "backspace", ...timing } };
            case 2:
                return { what: "keyboard:tap", payload: { key: "enter", ...timing } };
            case 3:
                return { what: "keyboard:tap", payload: { key: "space", ...timing } };
            case 4:
                return { what: "keyboard:tap", payload: { key: "tab", ...timing } };
            default:
                return {
                    what: "keyboard:type",
                    payload: { text: String.fromCodePoint(codePoint || 0), ...timing }
                };
        }
    }
    const dx = view.getInt16(0, true);
    const dy = view.getInt16(2, true);
    const flags = view.getUint8(5);
    const button =
        (flags & 0x7f) === BUTTON_RIGHT ? "right" : (flags & 0x7f) === BUTTON_MIDDLE ? "middle" : "left";
    switch (type) {
        case MSG_TYPE_CLICK:
            return {
                what: "mouse:click",
                payload: { button, double: Boolean(flags & FLAG_DOUBLE), ...timing }
            };
        case MSG_TYPE_SCROLL:
            return { what: "mouse:scroll", payload: { dx, dy, ...timing } };
        case MSG_TYPE_MOUSE_DOWN:
            return { what: "mouse:down", payload: { button, ...timing } };
        case MSG_TYPE_MOUSE_UP:
            return { what: "mouse:up", payload: { button, ...timing } };
        case MSG_TYPE_MOVE:
        default:
            return { what: "mouse:move", payload: { x: dx, y: dy, ...timing } };
    }
};

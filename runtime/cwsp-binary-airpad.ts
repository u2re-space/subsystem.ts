/**
 * Legacy 8-byte AirPad binary frames (parity with Java {@code CwspBinaryAirpad} and endpoint {@code message.ts}).
 */
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
    view.setUint16(6, 0, true);
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
    view.setUint16(6, 0, true);
    return buffer;
};

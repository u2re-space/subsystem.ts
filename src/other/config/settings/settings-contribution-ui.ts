/**
 * DOM helpers for settings contribution panels (no fest/lure — safe for any host).
 */

export const settingsHint = (text: string): HTMLElement => {
    const p = document.createElement("p");
    p.className = "field-hint";
    p.textContent = text;
    return p;
};

export const settingsHeading = (text: string): HTMLElement => {
    const h = document.createElement("h4");
    h.textContent = text;
    return h;
};

export const settingsTextField = (
    label: string,
    path: string,
    placeholder = "",
    type = "text"
): HTMLElement => {
    const wrap = document.createElement("label");
    wrap.className = "field";
    const span = document.createElement("span");
    span.textContent = label;
    const input = document.createElement("input");
    input.className = "form-input";
    input.type = type;
    input.autocomplete = "off";
    input.setAttribute("data-field", path);
    if (placeholder) input.placeholder = placeholder;
    wrap.append(span, input);
    return wrap;
};

export const settingsNumberField = (
    label: string,
    path: string,
    attrs: { min?: string; max?: string; step?: string; placeholder?: string } = {}
): HTMLElement => {
    const wrap = document.createElement("label");
    wrap.className = "field";
    const span = document.createElement("span");
    span.textContent = label;
    const input = document.createElement("input");
    input.className = "form-input";
    input.type = "number";
    input.setAttribute("data-field", path);
    if (attrs.min) input.min = attrs.min;
    if (attrs.max) input.max = attrs.max;
    if (attrs.step) input.step = attrs.step;
    if (attrs.placeholder) input.placeholder = attrs.placeholder;
    wrap.append(span, input);
    return wrap;
};

export const settingsCheckboxField = (label: string, path: string): HTMLElement => {
    const wrap = document.createElement("label");
    wrap.className = "field checkbox form-checkbox";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("data-field", path);
    const span = document.createElement("span");
    span.textContent = label;
    wrap.append(input, span);
    return wrap;
};

export const settingsSelectField = (
    label: string,
    path: string,
    options: Array<[string, string]>
): HTMLElement => {
    const wrap = document.createElement("label");
    wrap.className = "field";
    const span = document.createElement("span");
    span.textContent = label;
    const sel = document.createElement("select");
    sel.className = "form-select";
    sel.setAttribute("data-field", path);
    for (const [value, text] of options) {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = text;
        sel.appendChild(opt);
    }
    wrap.append(span, sel);
    return wrap;
};

export type SettingsPanelChild = HTMLElement | string;

export const settingsPanel = (
    id: string,
    title: string,
    children: SettingsPanelChild[]
): HTMLElement => {
    const section = document.createElement("section");
    section.className = "card settings-tab-panel";
    section.setAttribute("data-tab-panel", id);
    section.hidden = true;
    const h3 = document.createElement("h3");
    h3.textContent = title;
    section.appendChild(h3);
    for (const child of children) {
        if (typeof child === "string") section.appendChild(settingsHeading(child));
        else section.appendChild(child);
    }
    return section;
};

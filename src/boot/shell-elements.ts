/**
 * Custom element host for shell layouts (`cw-shell-<id>`).
 * Layout DOM lives in an open shadow root so shell SCSS can stay scoped.
 */
import type { ShellId } from "./types";

export interface ShellMountableHost extends HTMLElement {
    mountShellLayout(layout: HTMLElement): void;
}

class ShellHost extends HTMLElement implements ShellMountableHost {
    mountShellLayout(layout: HTMLElement): void {
        if (!this.shadowRoot) {
            this.attachShadow({ mode: "open" });
        }
        // WHY: Autonomous custom elements default to `display: inline`; without a block box the
        // host often collapses to 0 block-size while light-DOM slotted views overflow visibly.
        this.style.display = "block";
        this.style.boxSizing = "border-box";
        this.shadowRoot!.replaceChildren(layout);
    }
}

/** Tag returned from `ensureShellElementDefined`; hosts expose `mountShellLayout`. */
export type ShellElement = ShellMountableHost;

/**
 * Legacy name kept for readability at call sites that special-case minimal chrome
 * (icon registry adopted into shadow). Behavior matches `ShellElement`.
 */
export type MinimalShellHostElement = ShellMountableHost;

export function ensureShellElementDefined(id: ShellId): string {
    const tag = `cw-shell-${id}`;
    if (!customElements.get(tag)) {
        customElements.define(tag, ShellHost);
    }
    return tag;
}

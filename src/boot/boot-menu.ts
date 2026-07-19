/**
 * Boot Menu
 * 
 * Shell selection screen displayed at root (/) route.
 * User selects a shell (Basic, Faint, etc.) which is saved to preferences.
 * Then navigates to the default view (/viewer).
 */

import { H } from "fest/lure";
import { loadAsAdopted } from "fest/dom";
//@ts-ignore
import style from "./boot-menu.scss?inline";
import type { ShellId } from "./types";
import { pickEnabledView } from "shared/routing/views";
import { ensureHistoryBaseDataset, withHistoryBase } from "./history-base";

// ============================================================================
// Type Definitions
// ============================================================================

export type FrontendChoice = ShellId | "";

export type ChoiceScreenOptions = {
    seconds: number;
    defaultChoice: FrontendChoice;
    onChoose: (choice: FrontendChoice, remember: boolean) => void;
    initialRemember?: boolean;
};

export type ChoiceScreenResult = {
    container: HTMLElement;
    countdownEl: HTMLElement;
};

const normalizeShellChoice = (shell: ShellId): ShellId => {
    return shell === "faint" ? "minimal" : shell;
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Save shell preference to localStorage
 */
const saveShellPreference = (shell: ShellId, remember: boolean): void => {
    const normalizedShell = normalizeShellChoice(shell);
    try {
        localStorage.setItem("rs-boot-shell", normalizedShell);
        if (remember) {
            localStorage.setItem("rs-boot-remember", "1");
        }
    } catch {
        // Ignore localStorage errors
    }
};

/**
 * Navigate to the default view after shell selection
 */
const navigateToDefaultView = (shell: ShellId, remember: boolean): void => {
    const normalizedShell = normalizeShellChoice(shell);
    saveShellPreference(normalizedShell, remember);
    
    // Navigate to the configured default view (keep VDS path mount e.g. /cwsp).
    const defaultView = pickEnabledView("viewer");
    ensureHistoryBaseDataset();
    const nextPath = withHistoryBase(`/${defaultView}`);
    globalThis?.history?.pushState?.({ shell: normalizedShell, view: defaultView }, "", nextPath);
    
    // Dispatch route change event
    globalThis?.dispatchEvent?.(new CustomEvent('route-change', {
        detail: { view: defaultView, shell: normalizedShell }
    }));
    
    // Reload to apply shell
    globalThis.location.href = nextPath;
};

// ============================================================================
// Main Choice Screen Component
// ============================================================================

export const ChoiceScreen = (opts: ChoiceScreenOptions): ChoiceScreenResult => {
    // Create UI elements
    const elements = createUIElements(opts);
    const container = createContainer(opts, elements);

    // Set up event handlers
    setupEventHandlers(opts, elements);

    // Initialize focus
    queueMicrotask(() => elements.keyboardNavigation.focusAt(0));

    return { container, countdownEl: elements.countdown };
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create all UI elements for the choice screen
 */
const createUIElements = (opts: ChoiceScreenOptions) => {
    const headerText = H`<header class="choice-header">Boot menu</header>` as HTMLElement;
    const reasonsText = H`<div class="choice-reasons">Use the stable <b>Minimal</b> shell to ensure a safe first launch.</div>` as HTMLElement;

    const countdown = H`<div class="choice-countdown">Auto-starting in <b data-countdown>${opts.seconds}</b> seconds…</div>` as HTMLElement;
    const hint = H`<div class="choice-hint">Use <b>↑</b>/<b>↓</b> to select, <b>Enter</b> to boot.</div>` as HTMLElement;

    // Remember checkbox
    const remember = H`<label class="choice-remember">
        <input type="checkbox" />
        <span>Remember my choice</span>
    </label>` as HTMLElement;
    const rememberInput = remember.querySelector("input") as HTMLInputElement | null;
    if (rememberInput) rememberInput.checked = Boolean(opts.initialRemember);

    // Menu buttons
    const bigMinimalButton = H`<button class="minimal big recommended" type="button">Minimal</button>` as HTMLButtonElement;
    // Menu buttons array
    const buttons = [bigMinimalButton];

    // Keyboard navigation state object (mutable reference to persist currentIndex)
    const keyboardNavigation = {
        currentIndex: 0,
        focusAt(nextIdx: number) {
            const len = buttons.length;
            this.currentIndex = ((nextIdx % len) + len) % len;
            buttons[this.currentIndex]?.focus?.();
        }
    };

    return {
        headerText,
        reasonsText,
        countdown,
        hint,
        remember,
        rememberInput,
        bigMinimalButton,
        buttons,
        keyboardNavigation
    };
};

/**
 * Create and assemble the main container
 */
const createContainer = (_opts: ChoiceScreenOptions, elements: ReturnType<typeof createUIElements>) => {
    const container = H`<div class="choice container"></div>` as HTMLElement;
    const menu = H`<div class="choice-menu" role="menu"></div>` as HTMLElement;

    menu.append(elements.bigMinimalButton);
    container.append(
        elements.headerText,
        elements.countdown,
        elements.hint,
        menu,
        elements.remember,
        elements.reasonsText
    );

    return container;
};

/**
 * Set up event handlers for buttons and keyboard navigation
 */
const setupEventHandlers = (opts: ChoiceScreenOptions, elements: ReturnType<typeof createUIElements>) => {
    const { bigMinimalButton, keyboardNavigation, rememberInput, countdown } = elements;

    // Track if countdown is active (for cancellation on interaction)
    let countdownActive = true;
    let countdownTimer: ReturnType<typeof setInterval> | null = null;
    let remainingSeconds = opts.seconds;

    // Stop the countdown timer
    const stopCountdown = () => {
        countdownActive = false;
        if (countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
        }
        countdown.hidden = true;
    };

    // Button click handlers - navigate to default view with selected shell
    const handleChoice = (choice: FrontendChoice) => {
        stopCountdown();
        const remember = Boolean(rememberInput?.checked);
        
        // For shells, save preference and navigate to default view
        const shell = (choice || "minimal") as ShellId;
        navigateToDefaultView(shell, remember);
    };

    bigMinimalButton.addEventListener("click", () => handleChoice("minimal"));

    // Start countdown timer
    const countdownEl = countdown.querySelector("[data-countdown]");
    if (countdownEl && opts.seconds > 0) {
        countdownTimer = setInterval(() => {
            if (!countdownActive) return;
            
            remainingSeconds--;
            countdownEl.textContent = String(remainingSeconds);
            
            if (remainingSeconds <= 0) {
                stopCountdown();
                // Auto-select default choice (basic)
                handleChoice(opts.defaultChoice || "minimal");
            }
        }, 1000);
    }

    // Keyboard navigation
    const container = bigMinimalButton.closest('.choice.container') as HTMLElement;
    const brokenKey = (e) => {
        // Any key press cancels countdown
        stopCountdown();

        if (e.key === "ArrowDown") {
            e.preventDefault();
            keyboardNavigation.focusAt(keyboardNavigation.currentIndex + 1);
            return;
        }
        if (e.key === "ArrowUp") {
            e.preventDefault();
            keyboardNavigation.focusAt(keyboardNavigation.currentIndex - 1);
            return;
        }
        if (e.key === "Enter") {
            const el = document.activeElement as HTMLElement | null;
            const btn = el?.closest?.("button") as HTMLButtonElement | null;
            btn?.click?.(); container?.removeEventListener("keydown", brokenKey);
        }
    };

    container.addEventListener("keydown", brokenKey);

    // Mouse activity also cancels countdown
    container.addEventListener("mousedown", () => stopCountdown(), { once: true });
};

// ============================================================================
// Default Export - Mount Boot Menu
// ============================================================================

export default async (mountingElement: HTMLElement): Promise<void> => {
    await loadAsAdopted(style);
    
    // Check if there's a saved preference - if so, skip boot menu
    const rawSavedShell = localStorage.getItem("rs-boot-shell") as ShellId | null;
    const savedShell = rawSavedShell ? normalizeShellChoice(rawSavedShell) : null;
    const remember = localStorage.getItem("rs-boot-remember") === "1";
    
    if (savedShell && remember) {
        // User has a saved preference, skip boot menu and go to default view
        navigateToDefaultView(savedShell, true);
        return;
    }
    
    // Show boot menu for shell selection
    const { container } = ChoiceScreen({
        seconds: 10,
        defaultChoice: "minimal",
        onChoose: (choice, remember) => {
            const shell = (choice || "minimal") as ShellId;
            navigateToDefaultView(shell, remember);
        },
        initialRemember: false
    });
    
    mountingElement.append(container);
};

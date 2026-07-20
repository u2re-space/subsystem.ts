/*
 * Filename: crx-control-pair-modal.ts
 * FullPath: modules/projects/subsystem/src/other/config/settings/crx-control-pair-modal.ts
 * Change date and time: 20.45.00_20.07.2026
 * Reason for changes: CRX Control pairing modal (same UX as public SPA; not inline fields).
 */

export type CrxPairModalResult = {
    publicToken: string;
    deviceCode: string;
} | null;

const STYLE_ID = "cwsp-crx-control-pair-modal-style";
const TOKEN_HINT_KEY = "cwsp-control-public-token-hint";

const ensureStyle = (): void => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.cwsp-crx-pair-backdrop {
  position: fixed; inset: 0; z-index: 100000;
  background: rgba(6, 10, 16, 0.78);
  backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
  padding: 1.25rem;
  font-family: "Segoe UI", ui-sans-serif, system-ui, sans-serif;
  animation: cwsp-crx-pair-fade .16s ease-out;
}
@keyframes cwsp-crx-pair-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
.cwsp-crx-pair-modal {
  width: min(400px, 100%);
  background: linear-gradient(165deg, #161d28 0%, #10161f 100%);
  color: #e8eef5;
  border: 1px solid #2c3a4c;
  border-radius: 14px;
  padding: 1.35rem 1.4rem 1.2rem;
  box-shadow: 0 22px 56px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.03) inset;
  animation: cwsp-crx-pair-rise .18s ease-out;
}
@keyframes cwsp-crx-pair-rise {
  from { opacity: 0; transform: translateY(8px) scale(.98); }
  to { opacity: 1; transform: none; }
}
.cwsp-crx-pair-modal h2 {
  margin: 0 0 .4rem;
  font-size: 1.12rem;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.cwsp-crx-pair-modal .hint {
  margin: 0 0 1rem;
  font-size: .84rem;
  line-height: 1.45;
  color: #9aabbc;
}
.cwsp-crx-pair-modal .hint a {
  color: #7eb0ff;
  text-decoration: none;
}
.cwsp-crx-pair-modal .hint a:hover { text-decoration: underline; }
.cwsp-crx-pair-modal label {
  display: block;
  margin: 0 0 .85rem;
  font-size: .72rem;
  font-weight: 600;
  letter-spacing: .04em;
  text-transform: uppercase;
  color: #a8b8c8;
}
.cwsp-crx-pair-modal input {
  display: block;
  width: 100%;
  margin-top: .35rem;
  box-sizing: border-box;
  border: 1px solid #334155;
  border-radius: 9px;
  background: #0a0f15;
  color: #f1f5f9;
  padding: .65rem .75rem;
  font-size: .95rem;
  letter-spacing: .03em;
  outline: none;
  transition: border-color .15s, box-shadow .15s;
}
.cwsp-crx-pair-modal input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, .22);
}
.cwsp-crx-pair-modal input[name="deviceCode"] {
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  font-size: 1.15rem;
  letter-spacing: .18em;
  text-transform: uppercase;
}
.cwsp-crx-pair-modal .err {
  color: #fca5a5;
  font-size: .8rem;
  min-height: 1.15em;
  margin: .15rem 0 .85rem;
}
.cwsp-crx-pair-modal .row {
  display: flex;
  gap: .55rem;
  justify-content: flex-end;
  margin-top: .25rem;
}
.cwsp-crx-pair-modal button {
  border: 0;
  border-radius: 9px;
  padding: .58rem 1rem;
  font-size: .9rem;
  cursor: pointer;
  transition: background .12s, transform .08s;
}
.cwsp-crx-pair-modal button:active { transform: scale(.98); }
.cwsp-crx-pair-modal .cancel {
  background: #243041;
  color: #dbe4ee;
}
.cwsp-crx-pair-modal .cancel:hover { background: #2d3c50; }
.cwsp-crx-pair-modal .ok {
  background: #2f6fed;
  color: #fff;
  font-weight: 600;
}
.cwsp-crx-pair-modal .ok:hover { background: #3b7cf0; }
.cwsp-crx-pair-modal .ok:disabled {
  opacity: .55;
  cursor: wait;
}
`;
    document.head.appendChild(style);
};

const readTokenHint = async (): Promise<string> => {
    try {
        if (typeof chrome === "undefined" || !chrome?.storage?.local) return "";
        const bag = await chrome.storage.local.get(TOKEN_HINT_KEY);
        return String(bag?.[TOKEN_HINT_KEY] || "").trim();
    } catch {
        return "";
    }
};

const saveTokenHint = async (token: string): Promise<void> => {
    try {
        if (typeof chrome === "undefined" || !chrome?.storage?.local) return;
        const t = String(token || "").trim();
        if (t) await chrome.storage.local.set({ [TOKEN_HINT_KEY]: t });
    } catch {
        /* ignore */
    }
};

/** WHY: stale chrome.storage hint after Neutralino "Regenerate public token" breaks pairing. */
export const clearCrxPublicTokenHint = async (): Promise<void> => {
    try {
        if (typeof chrome === "undefined" || !chrome?.storage?.local) return;
        await chrome.storage.local.remove(TOKEN_HINT_KEY);
    } catch {
        /* ignore */
    }
};

/**
 * Modal for Control public token + live 20s device code (CRX options page).
 * Same credentials as https://cwsp.u2re.space — session stays persistent after pair.
 */
export const showCrxControlPairModal = async (opts?: {
    title?: string;
    hint?: string;
    initialPublicToken?: string;
    /** Last 4 chars of live Control public token (from /pair/hello). */
    publicTokenSuffix?: string;
    controlOrigin?: string;
    error?: string;
    /** Skip chrome.storage prefills (after Invalid public token). */
    ignoreStoredHint?: boolean;
    busyLabel?: string;
}): Promise<CrxPairModalResult> => {
    ensureStyle();
    const hinted = opts?.ignoreStoredHint
        ? String(opts?.initialPublicToken || "").trim()
        : opts?.initialPublicToken || (await readTokenHint());
    const suffix = String(opts?.publicTokenSuffix || "").trim();
    const hostLabel = String(opts?.controlOrigin || "")
        .replace(/^https?:\/\//i, "")
        .replace(/\/+$/, "");
    const defaultHint =
        `Copy <strong>Public token</strong> + live <strong>device code</strong> from Neutralino → CWSP → Control pairing` +
        (hostLabel ? ` (<code>${hostLabel}</code>)` : " (:29110)") +
        (suffix ? `. Token must end with <strong>…${suffix}</strong>` : "") +
        `. Session in this extension is persistent.`;

    return new Promise((resolve) => {
        const backdrop = document.createElement("div");
        backdrop.className = "cwsp-crx-pair-backdrop";
        backdrop.setAttribute("role", "dialog");
        backdrop.setAttribute("aria-modal", "true");
        backdrop.setAttribute("aria-labelledby", "cwsp-crx-pair-title");

        const modal = document.createElement("div");
        modal.className = "cwsp-crx-pair-modal";
        modal.innerHTML = `
          <h2 id="cwsp-crx-pair-title">${opts?.title || "Pair Control"}</h2>
          <p class="hint">${opts?.hint || defaultHint}</p>
          <label>Public token${suffix ? ` (…${suffix})` : ""}
            <input name="publicToken" type="password" autocomplete="off" spellcheck="false" placeholder="cwsp-pub-…" />
          </label>
          <label>Device code (20s · +10s grace)
            <input name="deviceCode" autocomplete="off" spellcheck="false" placeholder="ABC123" maxlength="12" />
          </label>
          <p class="err" data-err></p>
          <div class="row">
            <button type="button" class="cancel" data-cancel>Cancel</button>
            <button type="button" class="ok" data-ok>Pair &amp; verify</button>
          </div>
        `;
        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        const pubInput = modal.querySelector('input[name="publicToken"]') as HTMLInputElement;
        const codeInput = modal.querySelector('input[name="deviceCode"]') as HTMLInputElement;
        const errEl = modal.querySelector("[data-err]") as HTMLElement;
        const okBtn = modal.querySelector("[data-ok]") as HTMLButtonElement;
        if (hinted) pubInput.value = hinted;
        if (opts?.error) errEl.textContent = opts.error;

        let closed = false;
        const close = (value: CrxPairModalResult) => {
            if (closed) return;
            closed = true;
            backdrop.remove();
            resolve(value);
        };

        modal.querySelector("[data-cancel]")?.addEventListener("click", () => close(null));
        backdrop.addEventListener("click", (e) => {
            if (e.target === backdrop) close(null);
        });
        backdrop.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                close(null);
            }
        });

        const submit = () => {
            const publicToken = String(pubInput.value || "").trim();
            const deviceCode = String(codeInput.value || "")
                .trim()
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, "");
            if (!publicToken || publicToken.length < 8) {
                errEl.textContent = "Public token is required (from desk Neutralino Settings).";
                pubInput.focus();
                return;
            }
            if (deviceCode.length < 4) {
                errEl.textContent = "Enter the live device code shown on the device.";
                codeInput.focus();
                return;
            }
            okBtn.disabled = true;
            okBtn.textContent = opts?.busyLabel || "Pairing…";
            void saveTokenHint(publicToken);
            close({ publicToken, deviceCode });
        };

        okBtn.addEventListener("click", submit);
        codeInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                submit();
            }
        });
        pubInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                codeInput.focus();
            }
        });

        if (pubInput.value) codeInput.focus();
        else pubInput.focus();
    });
};

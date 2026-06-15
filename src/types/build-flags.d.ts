/**
 * Build-time view gating flags injected by the host app's bundler
 * (CrossWord Vite `define`, generated from `VITE_ENABLED_VIEWS`).
 *
 * Declared here so `routing/core/views.ts` can read them with a safe
 * `typeof` guard. In non-bundled contexts (tsx/dev) they are simply
 * `undefined`, and `views.ts` falls back to "enabled".
 */
declare const __RS_VIEW_VIEWER__: boolean | undefined;
declare const __RS_VIEW_EDITOR__: boolean | undefined;
declare const __RS_VIEW_WORKCENTER__: boolean | undefined;
declare const __RS_VIEW_EXPLORER__: boolean | undefined;
declare const __RS_VIEW_AIRPAD__: boolean | undefined;
declare const __RS_VIEW_SETTINGS__: boolean | undefined;
declare const __RS_VIEW_HISTORY__: boolean | undefined;
declare const __RS_VIEW_HOME__: boolean | undefined;
declare const __RS_VIEW_PRINT__: boolean | undefined;

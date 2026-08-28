<p align="center">
  <strong>@fest-lib/subsystem</strong><br>
  Settings, routing, document pipeline, and platform glue used by CWSP views and shells.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@fest-lib/subsystem"><img src="https://img.shields.io/npm/v/@fest-lib/subsystem?style=flat-square" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/@fest-lib/subsystem?style=flat-square" alt="MIT"></a>
</p>

Level 3 library (same band as FL.UI). Not a SPA. Workspace copies under `modules/projects/shared` are **not** SoT — edit this package.

```text
core · dom · object · lure · veela
 └── fest/subsystem   ← you are here
      └── views · shells · apps
```

## Install

Published name is `@fest-lib/subsystem`. In unite-2.man it is already a workspace package.

```bash
npm install @fest-lib/core @fest-lib/dom @fest-lib/object @fest-lib/lure @fest-lib/veela @fest-lib/subsystem
```

Peers: `core`, `dom`, `lure`, `object`, `veela` (`>=0.1.0`).

```ts
import { /* routing + utils from package root */ } from "@fest-lib/subsystem";
```

There is **no** `npm run publish` on this package yet (`0.1.0`, `build:publish` only). Treat it as a workspace dependency unless you add a release script.

## Layout

| Tree | Role |
| --- | --- |
| `src/routing/*` | channel actions, view-message routing, registry |
| `src/other/document` | Markdown → HTML / DOCX |
| `src/other/config/settings` | settings contributions |
| `src/store/*` | IDB / history |
| `src/service/*` | recognition / AI instructions |
| `src/other/utils` | shared helpers |

Root `src/index.ts` re-exports utils, types, and routing. Feature folders are imported by path inside the workspace (`com/…` aliases).

## Workspace

```bash
cd modules/projects/subsystem
npm run dev
npm run build:publish
```

Do not edit consumer trees under `*/subsystem` or `*/shared`. License: [MIT](LICENSE).

# CrossWord PWA Spec

## Canonical Ingress Model

The service worker is the canonical ingress stager for PWA-originated payloads:

- share target POSTs
- launch queue file opens
- background share notifications

The window is the canonical consumer:

- it reads staged payloads from cache
- it routes them through `ViewTransferRouting.ts`
- it optionally falls back to processing if routing cannot deliver

## Staging Contract

Staged payloads must persist:

- `source`
- `route`
- `timestamp`
- `title` / `text` / `url`
- `files`
- `fileCount`
- `imageCount`
- optional routing hint metadata

## Required Flow

1. service worker parses or receives ingress
2. service worker stages normalized payload to cache/OPFS boundary
3. service worker opens or focuses the app on `/share-target?shared=1`
4. window consumes staged payload and routes to canonical destination

## Guardrails

- do not split launch-queue orchestration across direct view routing and staged recovery
- keep server-side or AI processing fallback optional, not the canonical handoff path
- reuse the same staged payload shape for share target and launch queue

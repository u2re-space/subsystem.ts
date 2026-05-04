# CrossWord Shared Core Spec

## Scope

This layer owns CrossWord's app-facing message normalization, destination naming, and ingress staging helpers.

Primary files:

- `UnifiedMessaging.ts`
- `UnifiedMessagingSw.ts`
- `UniformInterop.ts`
- `ViewTransferRouting.ts`
- `ShareTargetGateway.ts`

## Contracts

- `UniformProtocolEnvelope` remains the rich transport/debug envelope
- `UnifiedMessage` remains the view/shell delivery contract
- `UniformInterop.ts` is the shared adapter between them for window, SW, CRX, and native boundaries

## Naming Model

Canonical destinations:

- `viewer`
- `workcenter`
- `explorer`
- `editor`
- `settings`
- `history`
- `home`
- `airpad`
- `print`

Compatibility aliases such as `markdown-viewer`, `file-explorer`, and `basic-*` must normalize through `Names.ts`. New code should emit canonical destination ids.

## Routing Rules

- app code sends canonical destinations through `sendMessage(...)` or `sendProtocolMessage(...)`
- view-channel fan-out via `rs-view-*` is allowed only as a transport mirror into the same handler path
- pending queue keys must use canonical destination ids

## Ingress Rules

- staged share-target and launch-queue payloads are persisted through `ShareTargetGateway.ts`
- the service worker stages ingress
- the window consumes staged ingress and routes it into views through `ViewTransferRouting.ts`

## Compatibility Guardrail

Do not create new SW-only or CRX-only envelope shapes. Extend the shared adapter instead.

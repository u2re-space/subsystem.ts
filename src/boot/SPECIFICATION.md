# CrossWord Shared Transport Spec

## Scope

This layer adapts app-level messages onto concrete transports such as:

- websocket / socket-io
- `BroadcastChannel`
- workers and service workers
- Chrome extension runtime APIs
- native shell bridges

## Canonical Rule

Transport adapters may add transport metadata, but they must not invent a second logical protocol contract. All adapters must normalize through the shared interop envelope before sending.

## Transport Vocabulary

Use the same transport taxonomy as `modules/projects/uniform.ts/src/newer/SPECIFICATION.md`:

- `worker`
- `shared-worker`
- `service-worker`
- `broadcast`
- `message-port`
- `websocket`
- `chrome-runtime`
- `chrome-tabs`
- `chrome-port`
- `chrome-external`
- `socket-io`

## CrossWord-specific Expectations

- `rs-view-*` and `rs-service-*` names are transport channel names, not destination ids
- destination ids are normalized before transport lookup
- transport logging should record canonical destination, protocol, and transport together

## Guardrails

- keep websocket crypto envelopes separate from interop envelopes
- prefer shared helpers over transport-local name or protocol alias tables
- service-worker host/client bootstrap must use the helper exported from the `uniform` transport layer instead of ad-hoc listeners

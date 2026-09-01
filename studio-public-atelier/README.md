# D’AUBE Studio — Public Atelier

Public-safe distribution surface for the D’AUBE Studio Living Atelier.

## Open

- Live host: https://d-aube-studio-public-atelier-7s9b5a.v2.appdeploy.ai/
- Planned canonical hostname: `https://studio.daubesonntag.com/` (`pending_dns` until DNS verification completes)
- Machine-readable stable channel: [`release-channel.json`](./release-channel.json)
- Release provenance: [`release-passport.v1.json`](./release-passport.v1.json)

## Supply model

The public shell is intentionally self-contained and browser-local. It can be installed as a PWA where the browser supports installation, retains the project only in local browser storage, and caches a bounded offline shell. It checks the stable release channel with `cache: no-store` so update discovery is not trapped behind the offline cache.

The public shell does **not** expose D’AUBE private AI execution, credentials, production mutation, privileged release authority, private data or internal runtime topology. AI controls are route simulations only and Ship remains locked.

## Upgrade model

`release-channel.json` is the public distribution contract. A new version may replace the stable pointer only after:

1. canonical source identity is recorded,
2. the public/private boundary is verified,
3. the public artifact has a release passport and rollback reference,
4. the active host returns verified readback evidence,
5. the release claim stays within what that evidence proves.

The service worker uses versioned caches and deletes older `daube-studio-public-*` caches on activation. Navigation remains network-first, while static shell assets can fall back to cache. The release channel is always network-first/no-store with cached fallback only when offline.

## Rollback

The release passport and stable channel retain the previous known public version and provider rollback reference. Rollback restores a previously verified public artifact; it never grants new backend or production authority.

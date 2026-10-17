# P4 — Device access model

P4 separates device authentication from surface, resource scope and optional human binding.

## Canonical device state

A device now persists:

- credential hash/salt — authentication only;
- `surface` — waiter or kitchen;
- `scope_type/scope_id` — currently `establishment` for paired mobile devices;
- optional `user_id` — human binding for attribution, never permission inheritance;
- status and last-seen metadata.

`device_type` is the canonical paired-device channel: `WAITER` or `KITCHEN`. Customer table ordering is public-resource access through `/m/:token`, including when that URL is opened on store-owned hardware.

## Canonical principal

`runtime.deviceAccess.authenticate()` returns a P2 device principal:

```js
{ kind: 'device', id, surface, userId }
```

Device capability resolution is based on **surface**, not on the bound human profile. Binding a waiter device to an Administrator therefore does not give the device finance, settings or access-management permissions.

## Current compatibility

Mobile credentials, blocking and rotation remain unchanged. Restaurant mobile routes authenticate paired staff devices through `deviceAccess`; public table ordering remains a separate token-scoped resource channel. P5/P8 will continue replacing remaining legacy module/route authorization gates.

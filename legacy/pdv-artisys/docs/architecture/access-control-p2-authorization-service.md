# P2 — Canonical Authorization Service

P2 defines the fail-closed authorization engine now used by the canonical access model.

## Canonical decision

```js
authorization.can({ principal, capability, surface, resource })
authorization.require({ principal, capability, surface, resource })
```

A decision combines:

1. a canonical principal;
2. a capability from the P1 registry;
3. an optional surface policy;
4. an optional resource-scope policy.

Unknown capabilities, malformed principals, resolver failures and policy failures deny access.

## Principal kinds

- `human`: a person authenticated locally;
- `device`: KDS, waiter or terminal surface;
- `system`: explicit privileged internal/bootstrap principal;
- `public-resource`: opaque-token access scoped to a public resource such as a table.

The core service does not interpret `admin`, `manager`, `cashier` or device-type business rules.

## Canonical permission sources

Human principals resolve permissions only from persisted `profile_id` + `profile_permissions`. Devices use the device-access policy and public resources use the explicit public-resource permission map. There is no role-to-permission compatibility adapter in the runtime.

## Security properties

- fail closed;
- `system` bypass works only for capabilities registered in P1;
- device permissions remain distinct from human permissions;
- public resource principals receive only explicit public capabilities;
- surface and resource policies can further restrict an already-granted capability;
- `require()` throws a stable HTTP-compatible 403 authorization error.

## Migration status

The runtime, HTTP routes and protected UI surfaces use the canonical authorization service. Human role names are not authorization inputs; official profiles are presets over the same canonical permission registry.

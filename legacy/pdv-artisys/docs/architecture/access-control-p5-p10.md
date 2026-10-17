# Access control roadmap — P5 to P10

This document records the completion criteria for the access-control migration after P0-P4.

## P5 — Module authorization

FOOD and WHOLESALE remain establishment modules. They are not profiles.

Each module declares:
- `accessCapability`
- `manageCapability`

Module enablement and module access are independent decisions:
1. module must be enabled;
2. the principal must have the module access capability;
3. management operations require `modules.manage`.

No module definition carries human role arrays.

## P6 — Native Access Center

The desktop application owns a native `access` route with four tabs:

- Pessoas
- Perfis
- Dispositivos
- Segurança

Commissions are not part of access control.

The server exposes dedicated APIs under `/api/v1/access/*` for profile management, assignment, device lifecycle, permission catalog, session/security inspection and revocation.

## P7 — Declarative navigation

Renderer route visibility is derived from the authenticated user's capability projection.

`access-policy.js` maps routes to capability requirements. The renderer consumes the user permission projection returned by login/session APIs. UI visibility is only a projection; server-side authorization remains authoritative.

## P8 — Removal of role gates

Core authorization gates no longer use:
- `ROUTE_ACCESS`
- module `accessRoles/manageRoles`
- `requireRole(...)`
- role arrays as security boundaries

The legacy `role` column remains only as a temporary compatibility field for older domain/UI code and bootstrap semantics. It is not the authorization source of truth.

Device types remain operational surfaces, never human RBAC roles.

## P9 — Audit and session security

Login success/failure, profile changes, device lifecycle, module changes, setting changes and explicit session revocation are security/audit events.

Sessions expose:
- stable session id
- user/profile projection
- permissions
- terminal
- creation/last-seen/expiry timestamps

Profile assignment or profile permission changes revoke affected sessions so the renderer cannot continue with a stale permission projection.

## P10 — Hardening matrix

The regression matrix covers:

- human × profile × capability
- module enabled/disabled × capability
- device × surface × capability
- resource/context scope (for example, a public table token scoped to one table)
- unknown capabilities fail closed
- protected Administrator profile
- anti-escalation when granting permissions
- installation owner invariants
- device credential rotation/blocking
- direct API authorization independent from hidden UI

A hidden button is never treated as an authorization boundary.

## Clean-install assumption

The product is currently deployed only to clean machines. P3-P10 therefore optimize the canonical fresh-install schema and bootstrap path instead of maintaining a complex in-field database conversion path. Compatibility fields may exist temporarily for code migration, but no customer data migration strategy is required for this roadmap.

# P1 — Permission Registry

P1 introduces the canonical permission vocabulary for the access-control roadmap.

## Scope

P1 is intentionally non-enforcing. Existing `role`, `ROUTE_ACCESS`, `accessRoles`, `manageRoles` and device-surface gates continue to behave exactly as before.

The registry exists so P2 can implement one authorization service against stable capability IDs instead of inventing permission names inside routers, renderers or modules.

## Contract

Canonical definitions live in:

`js/core/auth/permission-registry.js`

Every permission has:

- a stable lowercase `id`;
- a product-facing `group`;
- a short `label`;
- a behavioral `description`.

IDs are immutable API/domain vocabulary. Labels and descriptions may evolve without changing authorization semantics.

## Boundary decisions

- Human roles such as `admin`, `manager` and `cashier` are not permissions.
- KDS and waiter remain paired device surfaces, not profiles. Public table ordering is resource-scoped and does not become a paired device capability.
- FOOD and WHOLESALE remain establishment modules. The human capabilities are `restaurant.access` and `wholesale.access`; whether the module itself is enabled remains a separate condition.
- Ownership of the installation remains independent from permissions and profiles.
- Public QR access remains resource-scoped and is not represented as a staff capability.

## Next step

P2 will introduce a canonical authorization service that evaluates principal + capability + surface/resource context. Only in P2 do runtime gates begin migrating from role checks to this registry.

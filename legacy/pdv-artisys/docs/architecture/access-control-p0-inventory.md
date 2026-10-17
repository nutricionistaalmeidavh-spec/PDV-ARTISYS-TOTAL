# P0 Access-control inventory

This document freezes the current authorization surfaces before configurable profiles are introduced.

## Classification

| Current gate | Class | P0 decision | P1+ destination |
| --- | --- | --- | --- |
| `users.role` (`admin`, `manager`, `cashier`) | human authorization | preserve during P0 | migrate to profiles/capabilities |
| `desktop/renderer/home-role-model.js:ROUTE_ACCESS` | renderer authorization projection | preserve during P0 | replace with capability metadata |
| module `accessRoles` / `manageRoles` | module authorization | preserve during P0 | replace with capabilities |
| `mobile_devices.device_type` | operational surface identity | preserve | keep as surface/device type, not human RBAC |
| `x-device-id` + `x-device-key` | device authentication | preserve | canonical device principal |
| `x-terminal-id` + `x-terminal-key` | terminal authentication | preserve | canonical terminal principal |
| `x-pdv-token` | installation-local bootstrap/legacy local authentication | preserve only where currently required | narrow to setup/internal bootstrap |
| `actor.role='system'` | internal privileged principal | preserve and audit | explicit system principal |
| public `/m/:token` | resource-scoped public access | preserve separately | public-resource principal |
| `installation_activation.account_email` | installation owner identity | enforce | canonical ownership identity |
| `installation_activation.owner_user_id` | local owner binding | introduced in P0 | owner remains independent from configurable profile |

## Owner invariants

1. A commercially activated installation may create its first administrator only with the normalized `account_email` returned by activation.
2. The first administrator is bound to `installation_activation.owner_user_id`.
3. The owner must remain an active administrator until an explicit verified ownership-transfer flow exists.
4. Adding another administrator never transfers ownership.
5. Existing installations are auto-bound only when exactly one active administrator has an email matching `account_email`; ambiguous installations remain unbound.
6. Ownership is independent from authorization role/profile. A future configurable Administrator profile does not itself imply ownership.

## Operational surfaces

KDS and waiter are not user profiles. They remain authenticated device surfaces. Public table ordering is a token-scoped resource channel; opening the same table URL on store-owned hardware does not create another device surface.

FOOD/WHOLESALE are establishment modules, not user profiles. Public table QR access remains a resource-scoped public channel and never becomes a staff profile.

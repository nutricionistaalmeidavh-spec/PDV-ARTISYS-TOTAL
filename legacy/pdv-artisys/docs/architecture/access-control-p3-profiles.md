# P3 — Configurable access profiles

P3 makes human authorization persistent and profile-based for clean installations.

## Clean-install rule

There is no legacy customer database migration path. A new database boots with three profiles:

- **Administrador** — protected and receives every staff capability from the P1 registry;
- **Gerente** — configurable default management profile;
- **Operador** — configurable default frontline profile.

The legacy `users.role` column remains only as a compatibility projection while old navigation and server gates are removed in later roadmap phases. New authorization decisions for human principals resolve permissions from `users.profile_id -> profiles -> profile_permissions`.

## Schema

- `profiles`
- `profile_permissions`
- `users.profile_id`

Profile IDs are stable. The protected Administrator profile cannot be edited or deleted.

## Security

- profile creation/edit/assignment uses P2 capabilities;
- public-resource permissions cannot be assigned to human profiles;
- a principal cannot grant capabilities it does not possess;
- the installation owner must remain on the protected Administrator profile;
- assigning a custom profile uses the least-privileged legacy role projection (`cashier`) until legacy role gates are removed;
- the installation cannot lose its last active legacy administrator during the transition.

P6 will provide the native Access Center UI over this service.

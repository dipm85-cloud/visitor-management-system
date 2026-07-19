# Settings Ownership Map

Application Settings is the central settings front door. Existing specialist and legacy panels remain reachable through Application Settings until their controls are safely migrated.

| Settings area | Current location | Target location | Status | Migration risk | Future milestone | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| General | Application Settings -> General | Application Settings -> General | Native | Low | OHP-017C | Controlled registry values stay native in Application Settings. |
| Branding | Legacy VMS settings | Application Settings -> Branding | Legacy bridge | Medium | OHP-017C | Logo, theme and background stay in legacy settings until migrated. |
| Modules | Application Settings -> Modules | Application Settings -> Modules | Native | Low | OHP-017D | The duplicate Administration Module Configuration nav item was removed; Application Settings -> Modules is the visible entry point. |
| Visitors | Visitors workspace, legacy VMS settings and Form Requirements | Application Settings -> Visitors | Partially migrated | High | OHP-017C | Keep visitor and VMS controls bridged while Form Requirements stay native. |
| Shared Terminal | Administration -> Shared Terminals | Application Settings -> Shared Terminal | Linked | Medium | OHP-017C | Open the existing Shared Terminals administration panel. |
| Documents / Sign-off | Document Sign-offs administration and legacy agreement settings | Application Settings -> Documents / Sign-off | Linked | High | TBD | Keep specialist document/sign-off panels as source of truth. |
| People & Assignments | Application Settings -> People & Assignments | Application Settings -> People & Assignments | Partially migrated | Medium | OHP-017C | Assignment Form Requirements are native; wider people-policy settings remain future work. |
| Working Time | Reference Data working-time entities | Application Settings -> Working Time | Linked | High | TBD | Open existing Work Time Profiles, Break Rules and Unsociable rules. |
| Session Security | Access Control -> Online Users / System Messages | Application Settings -> Session Security | Linked | Medium | TBD | Open the existing Session Security settings card without changing timeout behaviour. |
| Notifications | Access Control -> Online Users / System Messages | Application Settings -> Notifications | Linked | Medium | TBD | Open Online Users, System Messages and Message History. |
| Access Control / Diagnostics | Administration -> Access Control | Application Settings -> Access Control / Diagnostics | Linked | Medium | TBD | Diagnostics remain in Access Control; Application Settings owns the front door. |
| Future LMT | Not available | Application Settings -> Modules -> Future LMT | Future | Low | Future | Reserved only; no runtime behaviour in OHP-017B.1. |

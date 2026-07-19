# Settings Ownership Map

Application Settings is the central front door for application behaviour settings. It can link to Reference / Configuration Data, Access Control, and specialist workspaces, but those shortcuts should be labelled as shortcuts and should not imply ownership.

## Settings vs Reference Data Boundary

Application Settings controls how the application behaves: branding, product identity, visitor behaviour defaults, Shared Terminal behaviour, session security, notification defaults, privacy guardrails, Form Requirements, module availability, and module behaviour settings.

Reference / Configuration Data stores customer-specific context used by modules, dropdowns, rules, or policies: Work Time Profiles, Break Rules, Unsociable Time Rules, Unsociable Rule Sets, Departments, Contracts, Sites, Employers/Organisations, visitor reason codes when implemented, agreement/document types where supported, and future LMT exception reasons or contract policies.

Security Configuration is customer-specific configuration that affects permissions. Role Presets, capability assignment, User Role Assignments, and effective capability review stay in Access Control, not generic Reference Data.

Operational Data is day-to-day data created by users: visits, assignments, document evidence, privacy cases, system message history, identity review requests, rota/calendar records, and future LMT weekly records.

## Area Ownership

| Area | Current owner | Target owner | Status | Notes |
| --- | --- | --- | --- | --- |
| General | Application Settings | Application Settings | Native setting | Controlled application identity and platform defaults stay native. |
| Branding | Application Settings with legacy fallback | Application Settings | Partially migrated setting | Application Settings owns commercial branding, shell/theme, logos, favicon, print logo and contrast defaults; legacy values remain fallback only. |
| Modules | Application Settings | Application Settings | Native setting | Module cards separate application behaviour settings from Reference Data, Security Configuration and operational workspaces. |
| Visitors | Application Settings plus Visitors workspace | Application Settings | Partially migrated setting | Visitor behaviour defaults and Form Requirements are settings. Visitor reason codes/dropdowns belong in Reference / Configuration Data when implemented. Visits remain operational data. |
| Shared Terminal | Application Settings plus Shared Terminals admin | Application Settings | Partially migrated setting | Terminal display and idle/reset behaviour are settings. Device/token administration remains a linked specialist admin area. |
| Documents / Sign-off | Application Settings plus Document Sign-offs admin | Application Settings | Partially migrated setting | Sign-off behaviour, identity-linked compliance, evidence display defaults, print branding and locked scroll guardrails are settings. Agreement/document types are Reference / Configuration Data. Evidence is operational data. |
| Privacy / Data Governance | Application Settings plus Privacy workspace | Application Settings | Partially migrated setting | Privacy guardrails, SAR pack defaults and reference-display defaults are settings. Cases, SAR evidence packs, anonymisation preview and rules matrix remain specialist/operational workspaces. |
| Identity Resolution | Identity Resolution workspace | Specialist workspace | Linked specialist workspace | Application Settings provides a shortcut only. Review requests, candidate queues, confirmed links and decision history are operational/specialist data. |
| People & Assignments | Application Settings plus People/Assignments workspaces | Application Settings | Partially migrated setting | Assignment Form Requirements are settings. Departments, contracts, sites, employers and work-time context are Reference / Configuration Data. Assignments are operational data. |
| Working Time | Reference Data working-time entities | Reference / Configuration Data | Managed in Reference Data | Work Time Profiles, Break Rules, Unsociable Time Rules and Unsociable Rule Sets are customer configuration. Rota Calendar is an operational workspace. Application Settings may link to these but must not present them as app settings. |
| Session Security | Access Control Online Users/System Messages | Application Settings | Linked specialist workspace | Staff inactivity and session behaviour are application settings, but the current editor remains linked until safely migrated. |
| Notifications | Application Settings plus Online Users/System Messages | Application Settings | Partially migrated setting | Message defaults, expiry, action grace and history row defaults are settings. Online users, send message and message history are operational/admin workspaces. Notification groups, alert rules and escalation rules are future configuration data. |
| Access Control / Diagnostics | Application Settings plus Access Control | Application Settings and Access Control | Partially migrated setting | Diagnostics defaults and locked Capability Inspector status are settings. Role Presets, capability assignment and User Role Assignments are Security Configuration owned by Access Control. |
| Reference / Configuration Data | Reference Data and specialist editors | Reference / Configuration Data | Managed in Reference Data | Sites, departments, contracts, working-time rules/profiles and future dropdown/rule data are customer context, not application settings. Organisations remain in their specialist workspace but are linked as customer configuration. |
| Future LMT | Not available | Application Settings plus Reference / Configuration Data | Future | LMT behaviour/default settings belong in Application Settings. LMT exception reasons and contract policies belong in Reference / Configuration Data. Weekly LMT records are operational data. |

## Navigation Rules

Application Settings remains the central home for application behaviour settings.

Reference / Configuration Data remains the home for customer-specific dropdowns, rules and policies.

Access Control remains the home for Security Configuration.

If an area appears in more than one place, the owner should be clear: one entry owns the data, and any other entry is a shortcut or deep-link.

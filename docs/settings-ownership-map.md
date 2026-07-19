# Settings Ownership Map

OHP-017G is the final settings ownership review before LMT work. Application Settings is the stable home for platform behaviour, branding, security defaults, notifications, form configuration and safe links. It may link to Reference / Configuration Data, Access Control, and specialist workspaces, but those links must be labelled by their real owner.

## Ownership Taxonomy

Application Settings owns app behaviour: branding, product identity, visitor behaviour defaults, Shared Terminal behaviour, session security defaults, notification defaults, privacy guardrails, Form Configuration, module availability, and module behaviour settings.

Reference / Configuration Data owns customer-specific business context, dropdowns, rules and policies: Work Time Profiles, Break Rules, Unsociable Time Rules, Unsociable Rule Sets, departments, contracts, sites, employers/organisations, reason codes, agreement/document types where supported, and future LMT exception reasons, finance mappings, contract rules or contract policies.

Access Control / Security Configuration owns permission-affecting setup: role presets, capability assignment, user role assignments, effective capability review, Capability Inspector access, and related diagnostics access controls.

Operational Workspaces own day-to-day records and tools: Rota Calendar, Visitor History, Privacy Cases, Document Evidence, system message sending/history, identity review queues, and future LMT weekly records.

## Final Status Labels

Use these compact labels in settings overview cards and module cards:

- Native
- Mostly native
- Partially migrated
- Managed in Reference Data
- Managed in Access Control
- Specialist workspace
- Legacy bridge
- Future

Avoid generic "Linked" for intentional owners. If Application Settings opens another area, the label should identify whether that area is Reference Data, Security Configuration, a Specialist workspace, an Operational workspace, or a Legacy bridge.

## Area Ownership

| Area | Current UI location | Final owner | Status | Remaining bridge | Notes |
| --- | --- | --- | --- | --- | --- |
| General | Application Settings -> General | Application Settings | Native | None | Controlled application identity and platform defaults stay native. |
| Branding | Application Settings -> Branding, with legacy fallback values | Application Settings | Mostly native | Legacy branding bridge for fallback compatibility | Application Settings owns commercial branding, shell/theme, logos, favicon, print logo, public-screen branding, branded contrast defaults, gradients and radius tokens. |
| Modules | Application Settings -> Modules | Application Settings | Native | None | Modules is the single visible module configuration entry point. Cards separate app behaviour settings from Reference Data, Security Configuration, specialist workspaces, operational workspaces and future modules. |
| Visitors | Application Settings plus Visitors workspace | Application Settings | Partially migrated | Visitor settings legacy bridge | Visitor behaviour defaults belong in Application Settings. Visitor Walk-in and Planned Visit required fields are owned by Form Configuration. Visitor reason codes/dropdowns belong in Reference / Configuration Data when implemented. Visit records remain operational data. |
| Shared Terminal | Application Settings -> Shared Terminal plus Shared Terminals admin | Application Settings | Partially migrated | Shared Terminals specialist admin | Terminal display and idle/reset behaviour are settings. Device/token administration remains a specialist admin workspace. |
| Documents / Sign-off | Application Settings -> Documents / Sign-off plus Document Sign-offs admin | Application Settings | Partially migrated | Document legacy tools where native workflows are not complete | Sign-off behaviour, identity-linked compliance, evidence display defaults, print branding and locked scroll guardrails are settings. Agreement/document types are Reference / Configuration Data. Evidence is operational data. |
| Privacy / Data Governance | Application Settings plus Privacy / Data Governance workspace | Application Settings | Partially migrated | Legacy GDPR workflow bridge | Privacy guardrails, SAR pack defaults and reference-display defaults are settings. Cases, SAR evidence packs, anonymisation preview and rules matrix remain specialist or operational workspaces. |
| Identity Resolution | Identity Resolution administration, opened from Application Settings -> Modules | Specialist workspace | Specialist workspace | None | Application Settings provides a shortcut only. Review requests, candidate queues, confirmed links and decisions are specialist operational data. |
| Form Configuration | Application Settings -> Form Configuration | Application Settings | Native | None | Form Configuration owns configurable form requirements for Assignments, Visitor Walk-ins, Planned Visits and future forms. Backend area codes remain `work_assignments`, `visitor_walk_ins` and `planned_visits`. |
| People & Assignments | People and assignment operational workspaces | People & Assignments module | Specialist workspace | None | People & Assignments remains the business module for people records and assignments. It is not the generic form settings owner. Departments, contracts, sites, employers and work-time context are Reference / Configuration Data. Assignments are operational data. |
| Working Time | Reference Data -> Working Time Configuration, plus Rota Calendar | Reference / Configuration Data | Managed in Reference Data | None | Work Time Profiles, Break Rules, Unsociable Time Rules and Unsociable Rule Sets are customer configuration. Rota Calendar is an operational workspace. Application Settings may link to working-time reference data but must not present it as app settings. |
| Session Security | Access Control -> Online Users / System Messages | Application Settings | Specialist workspace | Existing Access Control editor until migration is safe | Staff inactivity and session behaviour are application settings, but the current editor remains in its existing security/admin workspace. |
| Notifications | Application Settings plus Online Users / System Messages | Application Settings | Partially migrated | Operational messaging workspace | Message defaults, expiry, action grace and history-row defaults are settings. Online users, send message and message history remain operational/admin workspaces. Notification groups, alert rules and escalation rules are future Reference / Configuration Data. |
| Access Control / Diagnostics | Application Settings plus Administration -> Access Control | Application Settings and Access Control | Partially migrated | None | Application Settings owns diagnostics defaults and locked Capability Inspector status. Role Presets, capability assignment, User Role Assignments and effective capability review are Security Configuration owned by Access Control. |
| Reference / Configuration Data | Administration -> Reference Data | Reference / Configuration Data | Managed in Reference Data | Specialist editors where not yet consolidated | Sites, departments, contracts, working-time rules/profiles, organisations, dropdowns and future rule/policy data are customer context, not application settings. |
| Future LMT | Reserved card in Application Settings -> Modules | Application Settings, Reference / Configuration Data, and Operational Workspaces | Future | None | LMT behaviour/default settings belong in Application Settings. LMT exception reasons, finance mappings, contract rules and contract policies belong in Reference / Configuration Data unless they are security-related. Weekly LMT records belong in operational workspaces. |

## LMT Readiness

The OHP-017G ownership model is ready for LMT if these rules stay intact:

- LMT app behaviour/defaults go in Application Settings.
- LMT exception reasons, finance mappings, contract rules, contract policies, working-time rules and dropdown-style data go in Reference / Configuration Data unless they are security-related.
- LMT permissions, presets and effective access diagnostics go in Access Control / Security Configuration.
- LMT weekly records, rota/calendar work, exports, evidence and day-to-day review queues go in operational workspaces.
- Any temporary cross-entry must be labelled as Reference Data, Security Configuration, Specialist workspace, Operational workspace, or Legacy bridge.

## Navigation Rules

Application Settings remains the central home for application behaviour settings.

Reference / Configuration Data remains the home for customer-specific dropdowns, rules and policies.

Access Control remains the home for Security Configuration.

Operational workspaces remain the home for records and day-to-day actions.

If an area appears in more than one place, one entry owns the data and every other entry is a clearly labelled shortcut.

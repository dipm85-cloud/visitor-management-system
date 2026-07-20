# OH-013 Visitor Identity Transition

Milestone: `OH-013`  
Status: Transitional architecture note

## Purpose

OH-013 begins connecting the Visitor app to the Operations Hub People and Organisation foundations without changing the Visitor app database contract.

The current Visitor app still stores visitor identity on operational records as:

- `planned_visits.visitor_name`
- `planned_visits.company`
- `visit_log.visitor_name`
- `visit_log.company`

These fields remain the compatibility contract for kiosk sign-in, sign-out, visit history, agreements, notifications, exports, GDPR workflows and existing reporting.

## Current Relationship

When a staff user creates or fully edits a planned visit, the Visitor app now offers lookup controls backed by:

- `public.people`
- `public.organisations`

Selecting a Person copies `people.display_name` into the existing visitor name field. Selecting an Organisation copies `organisations.organisation_name` into the existing company field.

The selected Person or Organisation ID is not persisted yet. The link is therefore a UI-assisted identity selection, not a durable relational association.

## Backward Compatibility

The Visitor app continues to save the same legacy fields exactly as before:

- Visitor name is saved to `visitor_name`.
- Company is saved to `company`.
- Company remains optional.
- Unknown organisations can still be typed as text and created later.
- Existing planned visits and historical visit records are not migrated.
- Kiosk workflows continue to read and display `visitor_name` and `company`.

If People or Organisation lookup is unavailable, the typed legacy value is still saved. If creating a new Person is not permitted by current backend policy, planned visit creation can continue using the typed visitor name.

## Future Migration Path

A later milestone can introduce durable identity relationships after explicit schema, policy and migration design. The expected path is:

1. Add nullable relationship columns such as `person_id` and `organisation_id` to future Visitor activity records.
2. Backfill only through a governed matching process with review and audit history.
3. Preserve `visitor_name` and `company` as historical snapshots so old exports, evidence and audit records remain stable.
4. Update display helpers to prefer linked Person and Organisation names while retaining snapshot fallbacks.
5. Move permission enforcement from UI affordances to trusted service and RLS boundaries.

Until that migration is approved, `visitor_name` and `company` remain authoritative for Visitor app behaviour.

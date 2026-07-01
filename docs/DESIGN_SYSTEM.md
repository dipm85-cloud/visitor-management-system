# Operations Hub Design System

Milestone: `OH-002`  
Status: Platform design specification  
Applies to: Core shell, shared components and all Operations Hub apps

This document defines the common user-interface language for Operations Hub. It specifies behavior, structure, accessibility and responsive expectations. It does not define company branding or an implementation framework.

## 1. Design Goals

### Fast for operational users

The interface must support frequent, time-sensitive work with the fewest safe steps. Common actions stay visible, lists remain scannable and state changes provide immediate feedback.

Speed must not remove confirmation from destructive or irreversible actions.

### Minimal cognitive load

Users should not need to remember where information lives, decode inconsistent controls or repeatedly enter known facts. Labels use plain operational language, defaults are useful and each view presents a clear next action.

### Responsive-first

Every layout and component is designed for phone, tablet and desktop from the start. Responsive behavior is part of the component contract, not a later adaptation.

### Accessible

The target is WCAG 2.2 AA. All functionality must support keyboard operation, visible focus, semantic structure, assistive technology, sufficient contrast, reduced motion and non-colour status cues.

Accessibility requirements cannot be disabled by company configuration.

### Consistent

The same component, status and interaction must mean the same thing in every app. Apps may have specialised workflows, but they must use shared patterns before creating variants.

### Configuration-friendly

Components must accept governed configuration for labels, enabled options, field rules, density and workflow choices without changing their semantic meaning or accessibility behavior.

Configuration may select supported patterns. It must not inject arbitrary markup, styles or executable behavior.

## 2. Layout

### Responsive ranges

The standard responsive ranges are:

| Range | Width | Primary mode |
|---|---:|---|
| Phone | `0–599px` | Single-column, touch-first |
| Tablet | `600–1023px` | Flexible one/two-column |
| Desktop | `1024–1439px` | Persistent navigation and multi-panel workspace |
| Wide desktop | `1440px+` | Wider workspace with controlled line lengths |

Breakpoints describe available space, not device identity. Components must also respond to their container where supported.

### Desktop

- Persistent global navigation may use a left rail or sidebar.
- The header remains visible while the primary workspace scrolls.
- The workspace may show a list and a docked right-side information panel simultaneously.
- Content width should use available space without allowing unreadably long text lines.
- Dense operational tables are permitted when row height, focus and target sizes remain usable.

### Tablet

- Navigation collapses to a compact rail or menu.
- The main workspace remains primary; secondary context opens as an overlay panel.
- Two columns may be used when both remain readable and touch targets are preserved.
- Toolbars and filters may wrap into multiple rows.

### Phone

- Use one primary column.
- Navigation opens from a clearly labelled menu; a bottom navigation bar may be used only for three to five stable primary destinations.
- Toolbars reduce to the primary action plus an overflow menu.
- Side panels become full-screen sheets or routed detail views.
- Tables use horizontal scrolling, priority columns or record cards according to the data task.
- Fixed controls must not obscure content, browser controls or the on-screen keyboard.

### Navigation behaviour

Navigation has three levels:

1. Platform and app selection.
2. App sections.
3. Record or workflow context.

Rules:

- Exactly one current destination is visually and programmatically identified.
- Navigation order is stable across sessions unless capability or configuration removes an item.
- Hidden-by-capability destinations are not shown as disabled promises.
- Back behavior returns to the previous meaningful context, preserving filters and selection when safe.
- Deep links identify the app, section and record without requiring navigation replay.
- Navigation collapse does not change destination names or icons.

### Header

The platform header may contain:

- Operations Hub and current app identity.
- Company/site context.
- Global search.
- Today's Focus or exception indicator.
- Notifications.
- Help.
- User/session controls.

The header must not become a general action bar. Record and page actions belong in the page toolbar.

### Workspace

The workspace contains the active page layout. It:

- Owns page scrolling unless a component explicitly requires internal scrolling.
- Provides a clear reading and keyboard order.
- Supports list/detail and dashboard patterns.
- Preserves state when a side panel opens.
- Shows loading, empty, error and permission states in context.

### Right-side information panel

The right-side panel provides contextual detail, review or lightweight editing without losing the underlying workspace.

- Desktop: docked or overlay, typically `360–480px` wide.
- Tablet: overlay drawer with an obvious close action.
- Phone: full-screen sheet or detail page.
- Opening moves focus to the panel.
- Closing restores focus to the control or record that opened it.
- Unsaved changes require a clear discard/continue decision.
- The panel must not contain a second unrelated navigation hierarchy.

### Footer

The global footer is quiet and non-sticky unless required for legal or operational reasons. It may contain version, environment, support, privacy and accessibility links.

Page-level summaries and actions belong to the page summary/footer, not the global footer.

## 3. Standard Page Layout

Every app page follows this order:

### Title

The title area contains:

- One page-level heading.
- Optional concise description.
- Current scope or context.
- Optional status or exception summary.

The title must describe the user's task or subject, not an implementation name.

### Toolbar

The toolbar contains:

- One primary action where applicable.
- Secondary page actions.
- View controls.
- Export or print actions.
- Overflow for infrequent actions.

Destructive actions do not sit beside the primary action without clear visual separation.

### Filters

Filters:

- Begin with the most useful search or date/context controls.
- Use known context as defaults.
- Show active-filter count when collapsed.
- Provide a clear-all action.
- Apply immediately when inexpensive and predictable; otherwise use an explicit Apply action.
- Preserve values when users inspect a record and return.

Advanced filters use progressive disclosure.

### Workspace

The workspace contains the principal table, list, board, calendar, form or dashboard. It is the main landmark and receives focus after navigation when appropriate.

### Summary/Footer

The page summary/footer may show:

- Result count and scope.
- Selection count.
- Last refresh time.
- Totals or operational summary.
- Pagination.
- Safe bulk actions.

On phone, essential actions may use a sticky bottom action area if it does not obscure content.

## 4. Components

Every interactive component supports default, hover where relevant, focus, active, disabled, loading, error and read-only states.

### Buttons

Variants:

- Primary: the single preferred action in the current context.
- Secondary: alternative or supporting action.
- Tertiary/ghost: low-emphasis action.
- Destructive: an action with material removal, cancellation or irreversible impact.
- Icon button: compact action with an accessible name and tooltip where useful.

Rules:

- Use verbs that describe the outcome.
- Do not use colour alone to distinguish destructive actions.
- Loading buttons retain width, become unavailable and show progress text or an indicator.
- Disabled buttons should be avoided when the reason cannot be discovered; explain unmet requirements nearby.
- Minimum touch target is `44×44px`.

### Cards

Cards group related information or one coherent action. They:

- Have an optional heading and status.
- Avoid excessive nesting.
- Use consistent padding and alignment.
- Are clickable only when the whole card has one clear destination.
- Expose the same action to keyboard users.

Cards are not a substitute for semantic lists or tables.

### Tables

Tables are used for comparison across records.

- Use semantic headers and captions or accessible names.
- Align data by meaning; numeric values align consistently.
- Keep row actions in a predictable final column.
- Support keyboard-accessible sorting and filtering.
- Identify selected rows without colour alone.
- Show result count, loading, empty and error states.
- Preserve column meaning when horizontally scrolled.
- Sticky headers are permitted when they do not hide focus or content.
- Bulk actions appear only after selection.

Responsive table behavior is defined in Section 9.

### Forms

Forms:

- Follow a logical task order.
- Use visible labels; placeholders are examples, not labels.
- Group related controls with headings or fieldsets.
- Mark required fields consistently.
- Explain unusual requirements before submission.
- Validate at the appropriate boundary and provide a summary for multi-error submissions.
- Preserve entered data after recoverable errors.
- Place primary submit and cancel/back actions consistently.

### Inputs

- Use the correct semantic input type and autocomplete metadata.
- Labels, help text and errors are programmatically associated.
- Formatting must not prevent copy/paste or assistive input.
- Read-only and disabled are visually and semantically distinct.
- Prefixes/suffixes do not obscure the entered value.
- Known values are prefilled when safe under Know Before You Ask.

### Dropdowns

Use a native select for short, stable option lists where possible.

- Provide a meaningful prompt when no default is safe.
- Do not use a dropdown for binary choices when a checkbox or switch is clearer.
- Long or searchable lists use Autocomplete.
- Options use plain labels and expose unavailable reasons if disabled.

### Autocomplete

- Begins suggesting after sufficient input or explicit opening.
- Supports keyboard navigation, selection and dismissal.
- Announces result count and active option.
- Clearly distinguishes typed text from a selected record.
- Supports no-results and create-new paths only when the user has capability.
- Displays enough context to distinguish similar Parties or records.

### Search

Search is a first-class platform control.

- Global search can find shared entities across apps.
- Local search is clearly scoped to the current page.
- Results show entity type, distinguishing context and permitted next action.
- Recent searches may be shown when privacy permits.
- Search tolerates common spacing, case and formatting differences.
- Search does not expose records outside capability or scope.

### Badges

Badges label type, category or compact metadata. They are not interactive by default.

Badge text must remain understandable without colour.

### Status chips

Status chips represent operational state.

- Use the shared state vocabulary.
- Include text and optional icon.
- Use semantic colour consistently.
- Are interactive only when explicitly presented as a filter or state control.
- Never imply that UI state alone is authoritative.

### Progress bars

- Use determinate progress when total work is known.
- Include a textual value or status.
- Use indeterminate progress only when completion cannot be estimated.
- Do not animate continuously when reduced motion is requested.
- Progress does not replace an explanation of blocked or failed work.

### KPIs

A KPI contains:

- Metric name.
- Current value.
- Scope and time period.
- Freshness.
- Optional comparison or trend.
- Link to supporting records.

KPIs must not use unexplained calculations or rely on colour alone. A KPI is not actionable unless its destination or action is clear.

### Side panels

Side panels follow the layout and focus rules in Section 2. They use:

- A heading describing the record/task.
- Close control.
- Optional status and actions.
- Scrollable body.
- Stable action footer when needed.

### Modals

Modals are reserved for short, blocking decisions or tightly bounded tasks.

- Use a labelled dialog with trapped focus.
- Initial focus goes to the safest useful control.
- Escape closes only when closing is safe.
- Closing restores focus.
- Long, multi-step work uses a page or side panel instead.
- Nested modals are prohibited.

### Toast notifications

Toasts communicate brief, non-blocking outcomes.

- Success, information, warning and error use consistent semantics.
- Duplicate messages are suppressed.
- Important errors also remain visible in context.
- Toasts do not contain essential instructions available nowhere else.
- Auto-dismiss duration permits reading; users can dismiss manually.
- Screen readers receive an appropriate live-region announcement.

### Confirmation dialogs

Confirmations are used for destructive, irreversible, security-sensitive or high-impact actions.

- State the exact outcome and affected subject.
- Use an action-specific confirmation label.
- Default focus should favour the safe action.
- Typed confirmation is reserved for exceptional impact.
- A reason is requested when governance or audit requires it.

### Date pickers

- Support keyboard entry and calendar selection.
- Show the expected format.
- Use locale-aware display while preserving an unambiguous stored value.
- Clearly distinguish today, selected date and unavailable dates.
- Explain timezone when it affects meaning.
- Permit direct text entry for experienced users.

### Calendar

- Supports day, week or month views only when useful to the task.
- Maintains a visible current period and timezone.
- Events expose status, title and distinguishing context without colour alone.
- Keyboard users can move between dates and events.
- Dense periods provide an agenda/list alternative.

### Tabs

Tabs may be used for peer views of the same subject.

- Tabs are not global navigation.
- The active tab is programmatically identified.
- Arrow keys move between tabs according to the ARIA pattern.
- Tab state is deep-linkable or restorable where useful.
- Do not use tabs when users need to compare content simultaneously.

### Accordions

Accordions use progressive disclosure for optional or advanced content.

- Headers are buttons with expanded state.
- Important errors and requirements remain visible even when collapsed.
- Expansion state may be remembered for the current user where useful.
- Avoid nested accordion hierarchies.

### Empty states

An empty state explains:

- What is absent.
- Whether filters or permissions affected the result.
- What the user can do next.

Use a primary action only when the user has capability and creation is the likely next step.

### Loading states

- Preserve layout to prevent disruptive movement.
- Use skeletons for predictable content and progress indicators for actions.
- State what is loading when delay is noticeable.
- Allow cancellation only when it is real and safe.
- Replace loading with a clear retryable error if the operation fails.
- Never leave controls permanently disabled after success or failure.

## 5. Colour Philosophy

Colour is semantic. Company branding colours are not defined in this version of the design system.

Every semantic colour must:

- Meet contrast requirements in its actual context.
- Have a non-colour cue such as text, icon, shape or pattern.
- Mean the same thing in every app.
- Work in light, dark and high-contrast themes if those themes are introduced.

### Success

Use for completed, valid, healthy or confirmed outcomes. Do not use success merely to decorate a primary action.

### Warning

Use for attention needed, approaching limits, incomplete requirements or recoverable risk. Warning is not a weaker form of Danger when immediate action is required.

### Danger

Use for failure, destructive action, blocked operation, critical risk or invalid state. Reserve it so critical meaning remains clear.

### Information

Use for neutral guidance, current processing, new information or contextual notice that is neither success nor risk.

### Neutral

Use for default structure, inactive state, metadata, unavailable state and non-semantic emphasis.

Company branding may later define brand and accent tokens, but branding must not override semantic status tokens or accessibility contrast.

## 6. Typography

Typography prioritises legibility, hierarchy and dense operational scanning.

### Hierarchy

Use semantic headings in order. Visual styling must not replace document structure.

Recommended roles:

| Role | Purpose |
|---|---|
| Display/page title | Current app page or major workflow |
| Section header | Major content group |
| Subsection header | Local grouping within a section |
| Label | Field, control, KPI or metadata name |
| Body | Instructions and record content |
| Supporting text | Help, timestamps and secondary metadata |
| Table text | Compact comparable data |

### Titles

- One page title per page.
- Short, task-oriented wording.
- May use responsive fluid scaling within controlled minimum and maximum sizes.
- Must not wrap into an unreadable multi-line banner on phone.

### Section headers

- Clearly separate content regions.
- Maintain consistent spacing before and after.
- Do not use bold body text as an informal replacement.

### Labels

- Concise and persistent.
- Use sentence case.
- Use weight and spacing rather than all capitals.
- Never rely on placeholder text.

### Body

- Default body text should normally render at least `16px` equivalent.
- Use comfortable line height and controlled measure for prose.
- Operational metadata may be smaller only when contrast and readability remain sufficient.

### Table text

- May be more compact than body text but must remain readable at default zoom.
- Use tabular numerals where numeric comparison benefits.
- Do not shrink text to avoid responsive table decisions.

### Responsive scaling

- Typography scales gradually, not through abrupt device-specific redesigns.
- Phone layouts reduce large headings before reducing body text.
- Browser zoom to 200% must remain usable without loss of content or function.
- User text-size preferences must not break controls or truncate essential labels.

No company font family is specified yet. The eventual font stack must prioritise platform availability, legibility and performance.

## 7. Icons

- Use one coherent icon family across the platform.
- Icons support labels; they do not replace unfamiliar action text.
- Icon-only buttons require an accessible name and usually a tooltip.
- Decorative icons are hidden from assistive technology.
- Status icons always accompany text.
- Use consistent icons for recurring actions such as search, filter, edit, close, warning, export and print.
- Do not use different icons for the same action across apps.
- Do not use colour as the icon's only meaning.
- Avoid culturally ambiguous, novelty or decorative icons in operational workflows.
- Icons should align to standard component sizes and remain recognisable at common zoom levels.
- Motion within icons is limited to meaningful progress and respects reduced-motion preferences.

## 8. Interaction Rules

### Keyboard shortcuts

- Every action remains available without a shortcut.
- Shortcuts are discoverable in tooltips, menus or help.
- Global shortcuts must not conflict with browser or assistive-technology conventions.
- Single-character shortcuts are disabled while typing and should be configurable or avoidable.
- High-impact actions do not execute immediately from a shortcut.
- A shortcut opens the same confirmation and validation path as pointer activation.

Suggested platform shortcuts may include focus global search, open Today's Focus and close the active safe-to-close panel. Exact bindings require a separate decision and usability test.

### Focus

- Focus is always visible.
- Opening a page, modal or side panel places focus at a meaningful location.
- Closing transient UI restores focus to its trigger.
- Validation moves or links focus to the error summary/first invalid field without losing entered data.
- Asynchronous refresh does not unexpectedly steal focus.
- Focus order follows the visual and semantic workflow.

### Tab order

- Native document order is the default.
- Positive `tabindex` values are prohibited.
- Hidden and unavailable controls are removed from tab order.
- Repeated row actions remain predictable.
- Skip links provide access to navigation, search and main workspace.

### Mobile behaviour

- Touch targets are at least `44×44px`.
- Hover is never required.
- Long press is not the sole path to an action.
- The on-screen keyboard must not obscure the active field or primary action.
- Swipe gestures require visible alternatives.
- Destructive actions remain deliberate; they are not triggered by an unconfirmed swipe.

### Search-first philosophy

- Put search before complex navigation when the user knows the subject.
- Carry selected identity and scope into the next workflow.
- Show recent and suggested context only when privacy permits.
- Preserve search and filters when users inspect a result and return.
- Search results expose permitted next actions, not every possible action.

## 9. Responsive Rules

### Desktop

- Persistent platform navigation.
- Full toolbar and filter row where space permits.
- Tables display their normal comparison columns.
- A right-side panel may remain docked.
- Multi-column forms are permitted when reading order remains clear.

### Tablet

- Compact/collapsible navigation.
- Wrapping toolbar and filters.
- Priority table columns remain visible; secondary columns move into row detail.
- Side panels overlay the workspace.
- Forms generally use one or two columns according to available width.

### Phone

- Menu-based navigation and single-column workspace.
- One visible primary action; secondary actions move to overflow.
- Filters collapse behind a labelled control with active count.
- Side panels become full-screen.
- Forms use one column.
- Summary and essential actions may use a non-obscuring sticky footer.

### Breakpoints

Use the ranges defined in Section 2. Choose component behavior based on available space and content pressure, not user-agent detection.

No workflow may exist only at one breakpoint.

### Collapsing navigation

- Desktop sidebar collapses to a labelled compact rail before becoming a drawer.
- Tablet and phone drawers close after navigation.
- Current destination remains visible in the page header when navigation is hidden.
- Expanded/collapsed state may be remembered as a user preference.

### Table behaviour

Choose in this order:

1. Keep essential comparison columns visible.
2. Move secondary data into expandable row detail.
3. Allow labelled horizontal scrolling for genuine comparison tasks.
4. Use record cards when cross-column comparison is not essential.

Do not hide data silently. Column configuration must identify omitted fields and provide a way to inspect them.

### Side panel behaviour

- Desktop: docked or overlay.
- Tablet: overlay drawer.
- Phone: full-screen sheet/page.
- Panel content and actions remain the same across modes.
- Focus, close, unsaved-change and back behavior remain consistent.

## 10. UX Principles

### Know Before You Ask

Prefill known facts, carry context and avoid duplicate questions. Make inferred values visible and correctable where allowed.

### Minimise Thinking

Use familiar language, useful defaults, stable placement and clear next steps. Ask only for decisions the system cannot safely make.

### Progressive Disclosure

Show the normal path first. Reveal advanced filters, metadata and rare actions when needed without hiding risks or requirements.

### Exception Management

Prioritise overdue, blocked, missing, conflicting and high-risk work. Explain the exception and provide the permitted next action.

### Today's Focus

Give each user an actionable view of work due now, exceptions, recent changes and resumable tasks, filtered by capability and scope.

### Continue My Work

Preserve safe context such as filters, selected record and drafts. Revalidate capability and operational state before resuming an action.

### Search First

Let users begin with the person, organisation, vehicle, reference or activity they know rather than requiring knowledge of app ownership.

### Single Primary Action

Each page, panel, dialog or form has at most one visually dominant action. When no action is clearly primary, use secondary actions rather than inventing emphasis.

## 11. Future Components

Future components must follow all foundations, accessibility requirements and responsive rules in this document.

### Widget framework

A governed framework for configurable dashboard placement, sizing, refresh, scope, permissions, empty/error states and drill-through behavior.

### Dashboard widgets

Reusable operational widgets for exceptions, queues, KPIs, recent changes and Today's Focus. Every widget exposes freshness and supporting records.

### Charts

Accessible charts with text summaries, data-table alternatives, semantic colour and clear scope/time period. Charts never become the sole source of exact values.

### Kanban

A state-based work board with keyboard movement, capability-checked transitions, limits, exception indicators and a list alternative.

### Timeline

A chronological view of immutable Operational Events with actor, source, time, event type and linked records.

### Scheduler

A resource/time scheduling surface with conflict detection, keyboard operation, timezone clarity and a list alternative.

### Planning Calendar

A planning-focused calendar connecting demand, assignments, people, vehicles and locations while distinguishing planned from confirmed state.

### Heat maps

Density and exception visualisation with legends, non-colour alternatives and access to underlying records.

### People cards

Compact Party summaries showing distinguishing identity, current operational context, relevant status and capability-appropriate actions.

### Vehicle cards

Compact vehicle summaries showing identity, operator/owner, current status, assignments, exceptions and relevant actions.

### Labour allocation grid

A responsive planning grid for people, assignments, demand and conflicts, with keyboard editing, explicit state transitions and a table/list alternative.

### Report viewer

A governed report surface with scope, filters, freshness, definitions, accessible tables/charts, export controls and capability-aware saved views.

Future component adoption requires documented use cases, accessibility review, responsive behavior, configuration limits and regression examples before it becomes part of the shared system.

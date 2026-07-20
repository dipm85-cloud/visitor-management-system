# VMS NextGen UI Refactor

Production baseline: `main`
Development branch: `nextgen-ui`

## Current objective

Split the monolithic `index.html` into a maintainable HTML/CSS/JS structure without changing functionality.

## Foundation rules

- Work only on `nextgen-ui`.
- Do not modify `main` during NextGen refactor work.
- Do not redesign the UI during the foundation refactor.
- Do not add features during the foundation refactor.
- Do not change database, RLS, Supabase RPCs, or backend behaviour during this phase.
- Preserve existing behaviour first; improve internals only after the split is complete and tested.

## First safe split

The first step is intentionally mechanical:

- Move the existing inline `<style>` content to `assets/css/main.css`.
- Move the existing main inline `<script>` content to `assets/js/app.js`.
- Replace the inline blocks in `index.html` with file references.

No CSS selectors, JavaScript functions, DOM IDs, Supabase calls, or event handlers should be changed in this first split.

## Helper script

Run from the repository root:

```bash
node tools/split-index.js
```

Then review the diff before committing.

Expected result:

```text
index.html
assets/css/main.css
assets/js/app.js
```

## Next steps after the mechanical split is tested

Only after behaviour is confirmed unchanged:

1. Split `assets/js/app.js` into smaller modules.
2. Keep the global behaviour stable while creating clearer module boundaries.
3. Only then start UI redesign or feature work.

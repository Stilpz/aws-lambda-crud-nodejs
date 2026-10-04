## Spec

<!-- Link the approved spec in specs/ that governs this change. Only typo and documentation-only fixes are exempt. -->

## What changed

<!-- One or two sentences. -->

## Why

<!-- The problem or decision behind it, not a restatement of the diff. -->

## How I tested it

<!-- Commands run, endpoints tried, stage used. -->

## Checklist

- [ ] An approved spec governs this change and the diff stays inside its scope
- [ ] The branch started from `development` and this pull request targets `development`
- [ ] `npm run lint` and `npm test` pass
- [ ] New behavior has tests
- [ ] `docs/openapi.yaml` and the README are updated if the API changed
- [ ] Data access is scoped to the caller (`getOwnerId`)
- [ ] No credentials, tokens or `.env` files are included

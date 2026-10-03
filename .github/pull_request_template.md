## What changed

<!-- One or two sentences. -->

## Why

<!-- The problem or decision behind it, not a restatement of the diff. -->

## How I tested it

<!-- Commands run, endpoints tried, stage used. -->

## Checklist

- [ ] The branch started from `development` and this pull request targets `development`
- [ ] `npm run lint` and `npm test` pass
- [ ] New behavior has tests
- [ ] `docs/openapi.yaml` and the README are updated if the API changed
- [ ] Data access is scoped to the caller (`getOwnerId`)
- [ ] No credentials, tokens or `.env` files are included

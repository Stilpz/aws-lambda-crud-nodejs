# 0017: Define the API versioning and deprecation policy

- **Status:** Approved
- **Branch:** `define-api-versioning-policy` (started from `development`)
- **Roadmap step:** Frontend readiness track of [0000](0000-roadmap-to-layered-architecture.md), item "Contract stability policy"
- **Pull request:** to be filled when opened
- **Supersedes / depends on:** builds on [0004](0004-standardize-error-responses.md) (which deferred error-shape changes to this policy) and [0006](0006-redesign-task-table-keys.md) (the change that invalidated cursors). Informs the `add-patch-task-route` step (first deprecation, `PUT`), the `add-explicit-cors-origins` item (headers a browser can read) and the typed client item (spec 0014). None of them blocks this spec.

## Context

A React frontend is the first client that this project does not control end to end, and spec 0000 requires the API to stay stable for it. Today stability is only an intention. Three real episodes in this repository show why a written rule is needed:

- **The error shape.** Spec 0004 kept `{ "message": "..." }` (plus `errors` on validation failures) because moving to RFC 9457 problem details "would be a breaking change for clients", and explicitly deferred the question to "a versioning decision (roadmap: contract stability policy)". There is no rule yet that says what such a change would require.
- **The table key change.** Spec 0006 changed the table keys. The route, schemas and status codes did not change, but a `nextToken` issued before the deploy is rejected with `400`, new ids are version 7 UUIDs, and the old table with its data was deleted. Spec 0000 called it "the only breaking change", while spec 0006's own contract table says "public API shape: none". The project has no vocabulary to say which of those two statements is right.
- **Ids.** Task ids went from random version 4 to time-sortable version 7 UUIDs. `docs/openapi.yaml` says `format: uuid`, which stayed true. Nothing tells a client whether it may rely on the version, on the ordering of ids, or on anything but "it is a UUID".

Version numbers are also inconsistent today. `docs/openapi.yaml` declares `info.version: 1.0.0`, the git tags are `v1.0.0` and `v1.1.0`, and the file still says `1.0.0` at the commit tagged `v1.1.0`. There is no `CHANGELOG`; release notes exist only as GitHub releases. Roadmap step 11 will deprecate `PUT /tasks/{id}` in favor of `PATCH`, and the OpenAPI document currently has no `deprecated` marker anywhere. The README says `PUT` is "kept for compatibility" with no end date.

Facts checked while drafting (2026-10-03): RFC 9745 (Proposed Standard, 2025) defines the `Deprecation` response header as a structured-field date (for example `Deprecation: @1688169599`), allows a `Link` header with `rel="deprecation"`, and requires that a `Sunset` header (RFC 8594, HTTP-date format) is not earlier than the deprecation date. OpenAPI 3.0.3, the version this project uses, has the boolean `deprecated` on operations, parameters and schemas.

## Goal

Write one authoritative policy that defines what a breaking change is for this API, how changes are announced, deprecated and removed, how the OpenAPI version, the git tags and a changelog relate, and what a React client may rely on, and align the existing version numbers with it.

## Scope

1. **Policy document** `docs/API_VERSIONING.md` (English, authoritative), with these sections:
   - *Compatibility promise*: what a client can rely on, and what it must not assume (see Design, "What a client can rely on").
   - *Breaking, non-breaking and operational changes*: the classification tables from Design, with this repository's examples.
   - *Versioning scheme*: no version in the URL; the contract version is `info.version`; the rule for introducing a `/v2` path prefix if a breaking change cannot be made additively.
   - *Deprecation and removal*: the process, the minimum notice, the headers and the OpenAPI marker (see Design).
   - *Version numbers*: the relation between `info.version`, git tags and `CHANGELOG.md`, and the release checklist.
   - *Responsibilities*: what a spec must state (a "Compatibility" row in its Contract impact table) and what a reviewer checks.
2. **`CHANGELOG.md`** at the repository root, hand-maintained, following the Keep a Changelog headings (Added, Changed, Deprecated, Removed, Fixed) plus an "Upgrade notes" heading. It gets an entry for `1.0.0`, an entry for `1.1.0`, and an `Unreleased` section that records the changes already merged to `development` (the table key redesign and its consequences: version 7 ids, consistent listing, rejected old cursors, the table replacement and the loss of its data, the error boundary with unchanged bodies, the use-case layering with no API change).
3. **OpenAPI alignment** (`docs/openapi.yaml`): `info.version` is set to the value decided in "Decisions to confirm" (recommended `1.2.0`, the version the next release will carry), and the `info.description` gains a short "Stability" paragraph that links the policy and states that cursors are opaque and not valid across deployments. No path, schema, response or status code changes.
4. **Release checklist** in the policy and one line in `CONTRIBUTING.md` and in `.github/pull_request_template.md`: a change that touches `docs/openapi.yaml` classifies itself against the policy and updates `CHANGELOG.md` under `Unreleased`.
5. **Links** from `README.md` (API Reference section, and the `PUT` known-limitation line, which will point to the policy for the deprecation process) and from `docs/ARCHITECTURE.md` ("Open decisions": error shape and versioning items point to the policy). `AGENTS.md` gains one bullet under Documentation: contract changes follow `docs/API_VERSIONING.md`.
6. **Spanish references** updated to match the changed English files (`README.es.md`, `CONTRIBUTING.es.md`, `docs/ARCHITECTURE.es.md`), plus a `docs/API_VERSIONING.es.md` mirror with the same headings, tables and code blocks, kept untracked like the others.

## Out of scope

- Emitting `Deprecation` or `Sunset` headers from code, and marking `PUT /tasks/{id}` as `deprecated: true`: done by the `add-patch-task-route` step, which is the first user of this policy. This spec only defines the contract those headers follow.
- Exposing the headers to browsers (`Access-Control-Expose-Headers`) and any CORS setting: the `add-explicit-cors-origins` item. The policy states the requirement (a browser client cannot read `Deprecation`, `Sunset` or `Link` unless they are listed in the exposed headers) and that item implements it.
- Adding a `/v1` prefix or any route change, or a second API version.
- Changing the error body to RFC 9457. The policy states how it would have to be done; whether to do it is a separate spec.
- Automating release notes, version bumps or tag creation (tooling such as conventional commits or release bots), and CI enforcement that `info.version` matches the latest tag. The maintainer creates tags; a check can be added to the pipeline spec later.
- Creating a git tag or a GitHub release. The `Unreleased` entries become `1.2.0` when the maintainer releases.
- The typed client: spec 0014 consumes `info.version`; it does not define it.

## Design

### What a client can rely on

The OpenAPI file `docs/openapi.yaml` is the single source of truth. A client written against it can rely on, within one major version:

- The set of routes, methods and operation ids; the request and response schemas, field names, types and required fields; status codes per operation.
- The error body: `{ "message": string }` for every error, plus `errors: string[]` on `400` validation failures.
- Every task is addressed by `id`, a UUID. It is opaque: do not parse it, and do not assume a version or randomness.
- `GET /tasks` returns the caller's tasks oldest first, `limit` from 1 to 100 (default 50), and `nextToken` is `null` when there are no more pages; a page may be empty while a token is still returned.
- Ownership: another user's task is a `404`, identical to a missing one.
- A task is readable and listed immediately after creation or update (consistent reads).

A client must not assume, and the policy says so explicitly:

- That `nextToken` survives a deployment. Tokens are opaque and only valid for the user they were issued to. A `400` on a stored token means "start the listing again", and the React client treats it that way.
- That ids are version 4, version 7, sortable, or unique across users.
- That unknown response fields do not appear. Clients ignore fields they do not know.
- That an unlisted status code will not appear (for example `429` from throttling, or a `5xx` from the platform): clients handle any `4xx` and `5xx` generically through the `message` field.
- That the order of items within the same millisecond is defined (spec 0006).
- The wording of `message`, except in the examples as informative text; it is for humans, not for switching on.

### Classification

| Class | Rule | Version bump | Examples in this repository |
| --- | --- | --- | --- |
| **Breaking** | A client written to the previous contract can fail or misbehave | major | Removing or renaming a route, field or operation id; making an optional request field required; tightening validation (a stricter pattern, a lower `limit` maximum); changing a status code or the error body shape (the RFC 9457 question of spec 0004); changing the type or meaning of a field; changing the authentication scheme or the token the API accepts; returning a different set of items for the same call |
| **Non-breaking** | Old clients keep working unchanged | minor | A new route (`PATCH /tasks/{id}`); a new optional request field; a new response field; a new status code that clients already handle generically; loosening validation; a new optional query parameter |
| **Fix or clarification** | Behavior was wrong against the documented contract, or the text was | patch | The consistent read of `GET /tasks/{id}` (finding F8); correcting a description or an example |
| **Operational** | The contract is unchanged but a deployed stage or a client's stored state is affected | minor, with an **Upgrade notes** entry that is mandatory | The table key change of spec 0006: opaque cursors issued earlier are rejected with `400`, ids become version 7 UUIDs (allowed by `format: uuid`), the table and its data are replaced |

The key-change episode is classified as **operational**, not breaking: the documented contract (routes, schemas, codes, "tokens are opaque") held, and the cursor rule is part of the promise, not an exception to it. The data loss is real, which is why the class exists and why it demands an announcement and a stated recovery path. If a change would instead remove data or behavior a client can legitimately depend on, it is breaking.

A spec that touches the contract adds a **Compatibility** row to its Contract impact table naming the class. A reviewer compares the class with the diff of `docs/openapi.yaml`.

### Versioning scheme

- **No version in the URL.** Alternatives and why rejected:
  - *`/v1/...` prefix from now on:* it buys nothing while one version exists, costs a gateway route per function (this project declares one `httpApi` event per Lambda in `serverless.yml`), changes every documented URL and every client call, and invites a second copy of every handler. It is also not required to keep the right to break: the right is created by the policy, not by a prefix.
  - *Header or media-type versioning (`Accept: application/vnd...v2+json`, `API-Version`):* hard to try with `curl` and a browser address bar, and a custom request header makes a cross-origin browser call non-simple, adding a CORS preflight and an allowed-header entry. The React client would pay for it on every request.
- **The contract version is `info.version`**, semantic versioning: major for breaking, minor for non-breaking and operational, patch for fixes.
- **If a breaking change cannot be made additively** (add the new field or route, deprecate the old one, remove it after the notice period), the new behavior is published under a `/v2` path prefix for the affected routes only, and the old routes follow the deprecation process. That is the single case in which the URL carries a version. The decision to do so needs its own spec.
- **Additive first.** The default way to change anything is to add the new thing, deprecate the old thing, and remove it after the notice period. `PATCH` next to `PUT` (roadmap step 11) is the model.

### Deprecation and removal

1. **Announce:** a `Deprecated` entry in `CHANGELOG.md` under `Unreleased`, the operation or field marked `deprecated: true` in `docs/openapi.yaml` with a description that names the replacement and the removal date, and a mention in the README.
2. **Signal at runtime:** while an operation is deprecated, every response from it carries `Deprecation: @<unix seconds>` (RFC 9745), `Sunset: <HTTP-date>` (RFC 8594), and `Link: <url of the migration notes>; rel="deprecation"`. The headers are documented in the OpenAPI response of that operation. For a browser client to read them, the CORS configuration must expose them (see Out of scope).
3. **Notice period:** at least 90 days between the release that deprecates and the `Sunset` date, and never less than one minor release (see Decisions to confirm). Removal ships in a major version, or earlier only if the notice has elapsed and the changelog says so.
4. **Remove:** delete the route and its function; after the removal the gateway answers `404`. The removal is a `Removed` entry in the changelog. Clients are told by the `Sunset` date, not by a tombstone response.
5. **Security exceptions:** a vulnerability may force removal without notice; the changelog states it and why.

### Version numbers, tags and the changelog

- **One number.** The git tag `vX.Y.Z` of a release, `info.version` in `docs/openapi.yaml` and the changelog heading `## [X.Y.Z] - date` are always equal. The release pull request (`staging` to `production`) sets `info.version`, moves `Unreleased` to the new heading and, after merge to `production`, the maintainer tags that commit. This is a checklist item, not tooling (YAGNI).
- **Bump rule:** the highest class in the release decides the number. A release with no contract change (like `v1.1.0`, which was documentation, process and refactoring) is a minor or patch bump chosen by the maintainer, and `info.version` follows it; a client reading the version sees a number that moved but the changelog says "no API change".
- **Why one number and not two:** a React developer and an operator ask the same question ("what is deployed and what changed?"); two numbers (API contract and service) need a mapping table and the repository already drifted with one (`info.version` stayed `1.0.0` at `v1.1.0`). The cost accepted is that purely internal releases bump the API number.
- **The changelog is the human record, the OpenAPI file is the machine record.** GitHub release notes link to the changelog section instead of duplicating it.
- **Current state to fix:** `info.version` is `1.0.0`; the latest tag is `v1.1.0`; `development` holds unreleased operational changes (spec 0006). This spec sets `info.version` to the next release number so the next release only needs its date.

### Principles applied

- **KISS and YAGNI:** one number, a hand-kept changelog, no URL version and no tooling until a second version or a second maintainer makes them necessary.
- **Contract first:** the OpenAPI file is the source of truth; the policy is how it is allowed to change.
- **Explicit over implicit:** the three episodes are classified in writing so the next one is decided by rule, not by argument.

## Contract impact

| Area | Impact |
| --- | --- |
| Public API (`docs/openapi.yaml`) | `info.version` value and a Stability paragraph in `info.description`; no path, schema or response change. Compatibility class: none (documentation only) |
| Infrastructure (`serverless.yml`) | none |
| Data model | none |
| Dependencies | none |
| Documentation | new `docs/API_VERSIONING.md` and `CHANGELOG.md`; `README.md`, `CONTRIBUTING.md`, `.github/pull_request_template.md`, `docs/ARCHITECTURE.md`, `AGENTS.md`, `docs/openapi.yaml` description; Spanish references and mirror |

## Acceptance criteria

- [ ] `docs/API_VERSIONING.md` exists with the six sections of Scope item 1, and states the compatibility promise, what a client must not assume, the four-class table and the URL-versioning decision with the alternatives rejected.
- [ ] The three episodes (the `{ message }` error shape, the table key change with invalidated cursors, UUID version 7 ids) are each classified in the policy with the class and the reason.
- [ ] The deprecation process names the `Deprecation` header (RFC 9745), the `Sunset` header (RFC 8594), `Link rel="deprecation"` and OpenAPI `deprecated: true`, a minimum notice period, and the CORS exposure requirement.
- [ ] `CHANGELOG.md` has `1.0.0`, `1.1.0` and `Unreleased` sections; `Unreleased` records the table replacement, the rejected old cursors, the version 7 ids and the data loss under Upgrade notes. Entries match `git log v1.0.0..v1.1.0` and the merged specs 0003 to 0006.
- [ ] `docs/openapi.yaml` has the decided `info.version` and the Stability paragraph, and `git diff development -- docs/openapi.yaml` shows no change under `paths:` or `components:`.
- [ ] `npx @redocly/cli lint docs/openapi.yaml` passes.
- [ ] `info.version`, the changelog heading and the release checklist agree on the "one number" rule, and the policy states what the maintainer does at release time.
- [ ] `CONTRIBUTING.md`, the pull request template, `AGENTS.md`, `README.md` and `docs/ARCHITECTURE.md` link the policy; the Spanish references match their English files in headings, table rows and code blocks.
- [ ] No file under `src/`, `tests/`, `scripts/`, `.github/workflows/` or `serverless.yml` changed.
- [ ] `npm run lint` and `npm test` pass.

## Verification

```bash
test -f docs/API_VERSIONING.md && test -f CHANGELOG.md
grep -n "Deprecation\|Sunset\|rel=\"deprecation\"\|deprecated: true" docs/API_VERSIONING.md
grep -n "^## \[" CHANGELOG.md                                             # 1.0.0, 1.1.0 and Unreleased
git diff development -- docs/openapi.yaml | grep '^[+-]' | grep -v '^[+-][+-]'   # only info.version and description lines
npx @redocly/cli lint docs/openapi.yaml
git diff development --stat -- src tests scripts .github/workflows serverless.yml   # prints nothing
git log --oneline v1.0.0..v1.1.0                                          # source for the 1.1.0 entry
npm run lint && npm test
```

Heading parity of the Spanish files is checked by comparing the `grep '^#'` output of each pair.

## Commit plan

1. Add this spec (Draft, then Approved by the maintainer).
2. Add `docs/API_VERSIONING.md`.
3. Add `CHANGELOG.md` with the `1.0.0`, `1.1.0` and `Unreleased` entries.
4. Set `info.version` and add the Stability paragraph in `docs/openapi.yaml`.
5. Link the policy from `README.md`, `CONTRIBUTING.md`, the pull request template, `AGENTS.md` and `docs/ARCHITECTURE.md`.
6. Close this spec (Implemented, pull request recorded). The Spanish references are untracked and updated alongside commits 2 and 5 without being committed.

## Risks and rollback

- **Risk:** a policy nobody applies. Mitigated by the Compatibility row in every spec's contract table, the pull request template line and the reviewer check; enforcement by tooling is deliberately left for later.
- **Risk:** setting `info.version` ahead of the tag makes the file say `1.2.0` while the deployed release is `1.1.0`. Mitigated by the release checklist and by `Unreleased` in the changelog; the maintainer can instead choose to keep `1.1.0` until release (see Decisions to confirm).
- **Risk:** classifying the key change as operational rather than breaking is a judgment call another reader may dispute. Mitigated by recording the reasoning and the test for the opposite case.
- **Risk:** the 90-day notice is arbitrary for a project with one known client. Mitigated by making it a decision to confirm; a shorter period is acceptable while the only consumer is the maintainer.
- **Rollback:** documentation only (plus two fields of the OpenAPI info block). Revert the merge.

## Decisions to confirm

| # | Decision | Recommended default |
| --- | --- | --- |
| 1 | URL versioning | None now; a `/v2` prefix only for a breaking change that cannot be made additively |
| 2 | Classification of the spec 0006 key change | Operational (minor bump) with mandatory upgrade notes, not breaking |
| 3 | Next release number and when `info.version` moves | `1.2.0`, set in this change; the tag follows at release |
| 4 | Minimum deprecation notice | 90 days and at least one minor release |
| 5 | One number for tag, `info.version` and changelog | Yes, one number; internal-only releases still bump it |

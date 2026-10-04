# 0012: Add the PATCH /tasks/{id} route and deprecate PUT

- **Status:** Implemented
- **Branch:** `add-patch-task-route` (started from `development`)
- **Roadmap step:** 11 of [0000](0000-roadmap-to-layered-architecture.md)
- **Amendments:** 1 (see the end of this spec)
- **Pull request:** to be filled when opened
- **Supersedes / depends on:** builds on [0003](0003-add-task-use-cases.md) and [0004](0004-standardize-error-responses.md), and follows the deprecation process of [0017](0017-define-api-versioning-policy.md) (`docs/API_VERSIONING.md`); all merged. Built on the configuration split of [0011](0011-split-serverless-config-files.md) and on the CORS configuration of [0013](0013-add-explicit-cors-origins.md), which already allows `PATCH` and exposes `Deprecation` and `Sunset`. The idempotency key on `POST` left this step with the maintainer's approval (roadmap step 11b, spec number 0019). Interacts with 0010 (hardening: route throttling).

## Context

`PUT /tasks/{id}` is a partial update: only the fields sent change and at least one of `done`, `title` or `description` is required (`docs/openapi.yaml`, `src/handlers/schemas.js`). That is the semantics of `PATCH`, not of `PUT`, which replaces a representation. The README ("Known Limitations") and finding F11 in `docs/ARCHITECTURE.md` record it as kept "for compatibility". A React client generated from the contract (spec 0014) would expose a verb whose name lies about what it does.

`PUT` answers `200 { "message": "Task updated successfully" }` and discards the task: the repository already asks DynamoDB for `ReturnValues: "ALL_NEW"` (`src/infrastructure/dynamoTaskRepository.js`) but the port declares `update(...) => Promise<void>`. A client that wants the new state must issue a second `GET`.

Roadmap step 11 also lists "an optional idempotency key on `POST`". `POST /tasks` creates a task with a server-generated id (`src/application/createTask.js`), so a retried request creates a duplicate. Fixing that needs durable storage and a retention rule, which is a different kind of change from adding a route (see Design, "Idempotency").

## Goal

Add `PATCH /tasks/{id}` as the documented partial update, keep `PUT /tasks/{id}` working unchanged but marked deprecated in the contract and in its responses, and record the decision to deliver the `POST` idempotency key in its own spec.

## Scope

1. **Route and function:** a new function file `functions/patchTask.yml` for `PATCH /tasks/{id}` with the same JWT authorizer as the other task routes, included from the root `serverless.yml` (one added line in its `functions:` list), and a handler `src/handlers/patchTask.js`.
2. **Behavior of `PATCH`:** same input rules as today's update: JSON body, `Content-Type: application/json` (`415` otherwise, `422` on malformed JSON), the existing `updateTaskSchema` (at least one of `title`, `description`, `done`; unknown fields ignored; `title` non-blank), ownership scoped by the token, another user's task is `404`. Different from `PUT`: the success response is `200` with the **updated task** (the `Task` schema), not a message.
3. **Port and use case:** `TaskRepository.update` resolves the updated task instead of `void`; `DynamoTaskRepository.update` returns the `Attributes` it already receives with `ALL_NEW`; `updateTask` use case returns it. `PUT` keeps its `{ message }` body by ignoring the returned task.
4. **Deprecation of `PUT`, following section 4 of `docs/API_VERSIONING.md`:** `operation.deprecated: true` in OpenAPI with a description that names `PATCH` and the removal date, the headers `Deprecation`, `Sunset` and `Link` described in Design on **every** response the `updateTask` function produces (success and errors), and a `Deprecated` entry in the changelog.
5. **Tests:** handler tests for `PATCH` (success body, validation, `415`, `422`, `404`, `500`, ownership), use-case test for the returned task, repository tests for the returned attributes, tests that `PUT` is byte-for-byte unchanged apart from the added headers.
6. **Smoke test:** `scripts/smoke.sh` exercises `PATCH` as the main update check (own task `200` and returns the changed field, another user `404`) and keeps one `PUT` check that also asserts the `Deprecation` header.
7. **Documentation:** `docs/openapi.yaml`, README API tables and examples (use `PATCH`, mark `PUT` deprecated), `CHANGELOG.md` (`Added` and `Deprecated` entries under `Unreleased`), `docs/ARCHITECTURE.md` (F11 partly closed, roadmap row), project tree.

## Out of scope

- **The idempotency key on `POST`.** Moved to its own spec, number 0019 (roadmap step 11b, already recorded in spec 0000 with the maintainer's approval).
- Removing `PUT`: a later spec, after the sunset date has passed.
- The versioning and deprecation policy itself: spec 0017 (merged). This spec is its first use and must follow its section 4.
- JSON Merge Patch (RFC 7396) null-to-delete semantics or JSON Patch (RFC 6902): no field is removable today, so there is nothing to delete (YAGNI).
- Optimistic concurrency (`ETag`, `If-Match`): not required for a single-owner task list; a new spec if multi-device conflicts appear.
- CORS configuration: spec 0013 (merged). It already lists `PATCH` and exposes `Deprecation` and `Sunset`; `Link` is not CORS-safelisted for scripts and is not exposed, so only non-browser clients read it.
- Observability, throttling and per-function IAM for the new function: steps 6 and 9. The shared role already grants `dynamodb:UpdateItem`.

## Design

### The route

`PATCH` and `PUT` share one use case. Only the HTTP shape differs, which is exactly what the handler layer is for:

```
PATCH /tasks/{id}  ->  patchTask handler   -> updateTask use case -> 200 Task
PUT   /tasks/{id}  ->  updateTask handler  -> updateTask use case -> 200 { message } + Deprecation headers
```

Handlers are about ten lines each (`src/handlers/updateTask.js` is the template). The shared pieces (`updateTaskSchema`, `withJsonBody`, `withErrorMapping`, `getOwnerId`) are reused as they are. No new abstraction: two handlers that call one use case do not justify a factory (YAGNI, and the third-use rule in AGENTS.md).

### Why `PATCH` returns the task

A React client updating a checkbox needs the resulting task to refresh its cache; with the message body it must issue a second `GET`. The data is already fetched by DynamoDB at no extra cost (`ALL_NEW`). The port change is small and backwards compatible for every caller (a `void` result becomes a value). `PUT` is not changed, so existing clients see no difference.

### Deprecation signalling of `PUT`

Three layers, all additive:

1. **Contract:** `deprecated: true` on `PUT /tasks/{id}` in `docs/openapi.yaml`. Generators (spec 0014) surface it as a deprecation annotation. The description names `PATCH` as the replacement.
2. **Response headers** on every response of the `PUT` function, as required by section 4 of the policy:
   - `Deprecation: @<unix-seconds>` (RFC 9745, a Structured Field date): the moment `PUT` was deprecated.
   - `Sunset: <HTTP-date>` (RFC 8594), never earlier than the deprecation date and at least 90 days after the release that deprecates (policy section 4.3).
   - `Link: <migration notes url>; rel="deprecation"`, pointing at the changelog. A `successor-version` link is not used: the successor is the same URL with another method, which a `Link` header cannot express; the OpenAPI description and the README carry that information instead.
3. **Documentation:** README and OpenAPI say `PUT` is deprecated and give the migration (change the verb, optionally use the returned task).

The headers are added by a small wrapper around the `PUT` handler only (`withDeprecation`, in `src/handlers/`; a plain function around the middy-wrapped handler, so it also sees the `400`, `415` and `422` responses that middy produces), so they are present on `200`, `400`, `404`, `415`, `422` and `500` produced by the function. Responses generated by API Gateway itself (`401` from the authorizer, `404` for an unknown route) cannot carry them; that is documented. A browser can read `Deprecation` and `Sunset` because spec 0013 exposes them. The dates are two constants next to the handler, `deprecatedAt` (2026-10-03) and `sunsetAt` (2027-04-03, about six months later, comfortably over the 90 days of the policy); the maintainer adjusts them at release time if the release slips by more than three months.

What must not break: the `PUT` request schema, status codes, response body, error shapes and the ownership rule are unchanged, and the existing `updateTask` handler tests keep passing with unchanged assertions (headers are an addition). `scripts/smoke.sh` keeps a `PUT` check, so a regression is caught after deploy.

### Idempotency key on `POST`: separate spec (recommended)

Evaluated honestly:

- A key makes a retried `POST` return the first result instead of creating a second task. It needs durable memory of `(owner, key) -> result` that survives Lambda restarts, a retention rule (keys must expire, otherwise storage grows without bound), a rule for a key reused with a different body (`422` or `409`), and a rule for two concurrent requests with the same key.
- The existing table cannot hold the records safely: its key is `ownerId` + `id` and `GET /tasks` queries the whole owner partition, so any extra item type in the partition would appear in the listing. It needs its own table with a TTL attribute (or a transactional write), which is new infrastructure, new IAM and a data-model decision. Specs in this project that touch the data model (0006) are separate for the same reason.
- It has no dependency on `PATCH`. `PATCH` is idempotent by definition (repeating the same partial update yields the same state), so it needs nothing.
- Bundling them gives one pull request with a new route, a new table and a retention policy: hard to review and impossible to revert independently.

Recommendation: ship `PATCH` and the deprecation in this spec; write a follow-up spec "add idempotency key to task creation" whose outline is: header `Idempotency-Key` (the name used by the IETF `httpapi` draft on idempotency keys; the draft is not an RFC, so the contract documents the header itself), conditional put of a key record in a dedicated table with a TTL of 24 hours, request fingerprint stored with the record, a mismatch answers `422`, a replay answers the original `201` with the same task. That amendment of roadmap step 11 is part of Decision 1.

### Alternatives rejected

- *Only mark `PUT` deprecated, no `PATCH`:* leaves clients no correct verb to move to.
- *Changing `PUT` to return the task:* a response change on a verb we are deprecating; clients that parse `{ message }` could break. The point is that `PUT` stays frozen.
- *Making `PUT` a true replace (require all fields):* a breaking change; rejected for the deprecation path, which exists to avoid breakage.
- *One handler registered for both methods:* it would mix two response shapes behind a branch on the method (a handler with two reasons to change).
- *`Deprecation: true`:* the pre-RFC form; RFC 9745 defines a date value, which is what tooling parses.

### Principles applied

- **SRP and OCP:** handlers differ only in HTTP shape; the use case is untouched except for returning what the repository already has.
- **LSP:** every `TaskRepository` implementation, including the in-memory double in `tests/inMemoryTaskRepository.js`, must honor the new return value; the shared port documentation is updated in the same commit.
- **KISS and YAGNI:** no `ETag`, no merge-patch, no key store until a spec asks for it.
- **Clean Code:** the header logic lives in one small middleware, not in handler bodies.

## Contract impact

| Area | Impact |
| --- | --- |
| Public API (`docs/openapi.yaml`) | **Additive, not breaking.** New operation `PATCH /tasks/{id}` (`operationId: patchTask`, request `UpdateTask`, `200` `Task`, `400`, `401`, `404`, `415`, `422`, `500`). `PUT /tasks/{id}` gains `deprecated: true` and a description pointing to `PATCH` and the removal date; its body and codes are unchanged, and the `Deprecation`, `Sunset` and `Link` response headers are documented on its responses (as header components). `info.version` is already `1.2.0` (set by spec 0017 for the unreleased minor release), so it does not change here. |
| Compatibility (policy 0017) | **Non-breaking, minor** for the new route (a new route is the policy's own example) and the start of a deprecation for `PUT` (a deprecation is announced, not a removal). Recorded in the changelog under `Added` and `Deprecated`. |
| Client-visible behavior | New route. `PUT` responses gain `Deprecation`, `Sunset` and `Link` headers. No existing field, status or body changes. |
| Port | `TaskRepository.update` returns `Promise<Task>` instead of `Promise<void>`. Internal; no HTTP effect. |
| Infrastructure | One new function file `functions/patchTask.yml` with an `httpApi` event (`PATCH /tasks/{id}`, `cognitoAuthorizer`) and one added include line in the root `serverless.yml`. No new resource or permission. Takes effect on deploy; until then the route does not exist. |
| Data model | none |
| Documentation | `docs/openapi.yaml`, README (tables, examples, rules of thumb, known limitations, project tree), `CHANGELOG.md`, `docs/ARCHITECTURE.md` (F11, roadmap row), Spanish references (listed to the maintainer, not edited here), specs index |

## Acceptance criteria

- [x] `PATCH /tasks/{id}` with `{ "done": true }` answers `200` with the full updated task (all six fields, `done: true`); an empty body, a blank `title` or a wrong type answers `400` with the `{ message, errors }` shape; `Content-Type` other than JSON answers `415`; malformed JSON answers `422`; a missing task and another user's task answer `404` with the same body.
- [x] `PATCH` ignores `id`, `ownerId` and `createdAt` in the body, and changes only the fields sent.
- [x] `PUT /tasks/{id}` request validation, status codes and bodies are unchanged; the existing `tests/updateTask.test.js` assertions pass unchanged (new assertions for headers are added, none edited).
- [x] Every response of the `PUT` function, including `400`, `404`, `415`, `422` and `500`, carries `Deprecation: @<seconds>`, `Sunset: <HTTP-date>` (later than the deprecation date by at least 90 days) and `Link: <...>; rel="deprecation"`; the `PATCH` function sends none of them.
- [x] `TaskRepository.update` documents and returns the updated task; `DynamoTaskRepository` and `InMemoryTaskRepository` both do, covered by tests.
- [x] `docs/openapi.yaml` lints clean (`npm run lint:api`), contains `patchTask`, marks `updateTask` `deprecated: true`, documents the three headers on every `PUT` response except `401`, and its `PATCH` examples match the real responses.
- [x] `functions/patchTask.yml` defines the `patchTask` function on `PATCH /tasks/{id}` with the Cognito authorizer and `serverless.yml` includes it; no other line of the configuration changes, and `npx serverless print --stage dev` resolves it. Its handler path resolves to an exported function.
- [x] `scripts/smoke.sh` passes `bash -n`, checks `PATCH` own (`200`, returns the changed field) and foreign (`404`), and the `PUT` deprecation header.
- [x] README, `docs/ARCHITECTURE.md` and `CHANGELOG.md` describe `PATCH` first and `PUT` as deprecated (changelog `Added` and `Deprecated` entries); the English changes are listed for the Spanish mirror.
- [x] No idempotency code, table or header is present.
- [x] `npm run lint` and `npm test` pass.

## Verification

```bash
npm run lint && npm test
npm run lint:api
grep -n "deprecated: true" docs/openapi.yaml                       # exactly one, under put
grep -n "operationId: patchTask" docs/openapi.yaml
git diff development --stat -- serverless.yml functions                # one added include line and functions/patchTask.yml
npx serverless print --stage dev | grep -B2 -A6 "patchTask:"
grep -rniE "idempoten" src serverless.yml                          # prints nothing
bash -n scripts/smoke.sh
```

After the maintainer deploys to `dev`: `STAGE=dev ./scripts/smoke.sh` passes, and `curl -si -X PUT ... "$API_URL/tasks/$id"` shows the `Deprecation` header.

## Commit plan

1. Add this spec (Draft, then Approved by the maintainer), and amend it to the merged policy and configuration (this amendment).
2. Return the updated task from `TaskRepository.update` (port documentation, `DynamoTaskRepository`, the in-memory double and the shared contract suite), with tests; the `updateTask` use case already returns the repository result.
3. Add the `patchTask` handler with its tests.
4. Register the `patchTask` function in `functions/patchTask.yml` and include it from `serverless.yml`.
5. Add the deprecation headers wrapper to the `PUT` handler, with tests.
6. Document `PATCH` and deprecate `PUT` in `docs/openapi.yaml`.
7. Extend the smoke test.
8. Update the README, `docs/ARCHITECTURE.md` and `CHANGELOG.md`, and close this spec (the roadmap row of step 11 was already amended).

## Risks and rollback

- **Risk:** CORS rejects `PATCH` preflights if `PATCH` is missing from the allowed methods. Resolved: spec 0013 is merged below this branch and lists `PATCH`, `Deprecation` and `Sunset`; its configuration test pins them.
- **Risk:** clients ignore the deprecation. Accepted: signalling is advisory; removal is a later spec with a sunset date.
- **Risk:** a wrong or stale date. The two dates are constants in one place and a test pins the header formats and the 90 day minimum between them. If the release slips by more than three months, the maintainer moves them in the release pull request.
- **Risk:** the port change breaks a third repository implementation. None exists besides the Dynamo one and the test double, both updated in the same commit.
- **Rollback:** revert the merge and redeploy; the `patchTask` function and route disappear and `PUT` returns to its previous responses. No data is touched.

## Decisions to confirm

1. **Idempotency key leaves this step (recommended).** Default: this spec delivers `PATCH` and the deprecation only; a separate spec adds the key with its own table and retention, and the roadmap row of step 11 is amended accordingly. Alternative: keep it here, accept a larger pull request with a new table.
2. **`PATCH` returns the updated task (recommended)**, with the port change. Alternative: return `{ message }` like `PUT` and leave the port as it is (smaller, but the React client must re-fetch).
3. **Sunset date (amended, see Amendment 1).** Originally: no `Sunset` until the maintainer commits to a date. Now: `Sunset` is sent from the first release, 2027-04-03, because policy 0017 requires it on every response of a deprecated operation.
4. **OpenAPI version bump (amended).** `info.version` is already `1.2.0` (spec 0017), so nothing changes here; the new route is part of that minor release.
5. **Deprecation headers scope (recommended: every response of the `PUT` function).** Alternative: only the `200`.

## Amendment 1

**Approved by the maintainer**, including the dates: deprecation 2026-10-03 and `Sunset` 2027-04-03, with the `Link` header pointing at the changelog on the repository's `main` branch.

Written when implementation started, after specs 0007, 0011, 0013, 0016, 0017 and 0018 were merged into the branch. Reality differed from the draft in these points, so the spec was changed before any code:

- **The policy requires `Sunset` and `Link`.** Section 4.2 of `docs/API_VERSIONING.md` (spec 0017) says every response of a deprecated operation carries `Deprecation`, `Sunset` and `Link: <...>; rel="deprecation"`, with at least 90 days between the release that deprecates and the `Sunset` date, and names this step as its first use. The draft's Decision 3 ("no `Sunset` yet") contradicts it. The sunset date is now sent from the start (2027-04-03, with the deprecation date 2026-10-03; both constants, to be moved at release time if needed), and the draft's rejection of `Link` applies only to the `successor-version` relation, not to `rel="deprecation"`. **Decision 3 was approved in its original form; this amendment needs re-approval by the maintainer.**
- **The configuration is split** (spec 0011): the new function is `functions/patchTask.yml` plus one include line, not a block in `serverless.yml`.
- **`info.version` is already `1.2.0`** (spec 0017), so Decision 4 no longer changes it; the changelog `Unreleased` section is where this change is recorded (policy section 5), with `Added` and `Deprecated` entries and a compatibility class.
- **The roadmap row of step 11 was already amended** (step 11b, spec 0019), so no roadmap edit is part of this spec.
- **CORS is merged** (spec 0013) with `PATCH`, `Deprecation` and `Sunset` already listed.
- **The `updateTask` use case needs no change:** it already returns what the repository returns, so only the port, the Dynamo repository, the in-memory double and the shared contract suite change. `tests/helpers.js` gives `mockDynamo` a default `{}` result, because a real client always resolves an object; no assertion of an existing test changes.

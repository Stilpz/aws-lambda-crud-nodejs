# 0012: Add the PATCH /tasks/{id} route and deprecate PUT

- **Status:** Draft
- **Branch:** `add-patch-task-route` (started from `development`)
- **Roadmap step:** 11 of [0000](0000-roadmap-to-layered-architecture.md)
- **Pull request:** to be filled when opened
- **Supersedes / depends on:** builds on [0003](0003-add-task-use-cases.md) and [0004](0004-standardize-error-responses.md) (both merged). Interacts with 0010 (hardening: route throttling), 0011 (config split: where the new function is declared) and 0013 (CORS: `PATCH` and the deprecation headers must be allowed and exposed). See Decisions 1 and 5: this spec **proposes amending the roadmap** so the idempotency key on `POST` leaves step 11.

## Context

`PUT /tasks/{id}` is a partial update: only the fields sent change and at least one of `done`, `title` or `description` is required (`docs/openapi.yaml`, `src/handlers/schemas.js`). That is the semantics of `PATCH`, not of `PUT`, which replaces a representation. The README ("Known Limitations") and finding F11 in `docs/ARCHITECTURE.md` record it as kept "for compatibility". A React client generated from the contract (spec 0014) would expose a verb whose name lies about what it does.

`PUT` answers `200 { "message": "Task updated successfully" }` and discards the task: the repository already asks DynamoDB for `ReturnValues: "ALL_NEW"` (`src/infrastructure/dynamoTaskRepository.js`) but the port declares `update(...) => Promise<void>`. A client that wants the new state must issue a second `GET`.

Roadmap step 11 also lists "an optional idempotency key on `POST`". `POST /tasks` creates a task with a server-generated id (`src/application/createTask.js`), so a retried request creates a duplicate. Fixing that needs durable storage and a retention rule, which is a different kind of change from adding a route (see Design, "Idempotency").

## Goal

Add `PATCH /tasks/{id}` as the documented partial update, keep `PUT /tasks/{id}` working unchanged but marked deprecated in the contract and in its responses, and record the decision to deliver the `POST` idempotency key in its own spec.

## Scope

1. **Route and function:** a new function `patchTask` in `serverless.yml` for `PATCH /tasks/{id}` with the same JWT authorizer as the other task routes, and a handler `src/handlers/patchTask.js`.
2. **Behavior of `PATCH`:** same input rules as today's update: JSON body, `Content-Type: application/json` (`415` otherwise, `422` on malformed JSON), the existing `updateTaskSchema` (at least one of `title`, `description`, `done`; unknown fields ignored; `title` non-blank), ownership scoped by the token, another user's task is `404`. Different from `PUT`: the success response is `200` with the **updated task** (the `Task` schema), not a message.
3. **Port and use case:** `TaskRepository.update` resolves the updated task instead of `void`; `DynamoTaskRepository.update` returns the `Attributes` it already receives with `ALL_NEW`; `updateTask` use case returns it. `PUT` keeps its `{ message }` body by ignoring the returned task.
4. **Deprecation of `PUT`:** `operation.deprecated: true` in OpenAPI with a description that points to `PATCH`, and the response headers described in Design on **every** response the `updateTask` function produces (success and errors).
5. **Tests:** handler tests for `PATCH` (success body, validation, `415`, `422`, `404`, `500`, ownership), use-case test for the returned task, repository tests for the returned attributes, tests that `PUT` is byte-for-byte unchanged apart from the added headers.
6. **Smoke test:** `scripts/smoke.sh` exercises `PATCH` as the main update check (own task `200` and returns the changed field, another user `404`) and keeps one `PUT` check that also asserts the `Deprecation` header.
7. **Documentation:** `docs/openapi.yaml`, README API tables and examples (use `PATCH`, mark `PUT` deprecated), `docs/ARCHITECTURE.md` (F11 partly closed, roadmap row), project tree.

## Out of scope

- **The idempotency key on `POST`.** Moved to its own spec, to be written and numbered when the maintainer approves Decision 1, which also amends the roadmap row for step 11.
- Removing `PUT` or choosing a removal date: a later spec, after the sunset date has passed.
- A versioning or deprecation policy for the whole API: roadmap item `define-api-versioning-policy`. This spec applies the signalling it will formalize and must not contradict it.
- JSON Merge Patch (RFC 7396) null-to-delete semantics or JSON Patch (RFC 6902): no field is removable today, so there is nothing to delete (YAGNI).
- Optimistic concurrency (`ETag`, `If-Match`): not required for a single-owner task list; a new spec if multi-device conflicts appear.
- CORS configuration: spec 0013 (it must list `PATCH`; see Risks).
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
2. **Response headers** on every response of the `PUT` function:
   - `Deprecation: @<unix-seconds>` (RFC 9745, a Structured Field date: the moment `PUT` became deprecated, i.e. the release date of this change).
   - `Sunset: <HTTP-date>` (RFC 8594), **only once** the maintainer fixes a removal date (Decision 3). Announcing a date the project has not committed to is worse than none.
   - `Link: </tasks/{id}>; rel="successor-version"` is **not** used: the successor is the same URL with another method, which a `Link` header cannot express. The OpenAPI description and the README carry that information instead.
3. **Documentation:** README and OpenAPI say `PUT` is deprecated and give the migration (change the verb, optionally use the returned task).

The headers are added by a small middleware applied to the `PUT` function only (`withDeprecation`, in `src/handlers/`), so they are present on `200`, `400`, `404`, `415`, `422` and `500` produced by the function. Responses generated by API Gateway itself (`401` from the authorizer, `404` for an unknown route) cannot carry them; that is documented. A browser can only read these headers if CORS exposes them (spec 0013, `exposedResponseHeaders`); this spec lists the exact names (`Deprecation`, `Sunset`) for that spec.

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
| Public API (`docs/openapi.yaml`) | **Additive, not breaking.** New operation `PATCH /tasks/{id}` (`operationId: patchTask`, request `UpdateTask`, `200` `Task`, `400`, `401`, `404`, `415`, `422`, `500`, same shared response components). `PUT /tasks/{id}` gains `deprecated: true` and a description pointing to `PATCH`, its body and codes unchanged; the `Deprecation` (and later `Sunset`) response headers are documented as header components on its responses. `info.version` moves to `1.2.0` (additive change; spec 0014's drift check will need regenerating, see Decision 4). |
| Client-visible behavior | New route. `PUT` responses gain a `Deprecation` header. No existing field, status or body changes. |
| Port | `TaskRepository.update` returns `Promise<Task>` instead of `Promise<void>`. Internal; no HTTP effect. |
| Infrastructure (`serverless.yml`) | One new function `patchTask` with an `httpApi` event (`PATCH /tasks/{id}`, `cognitoAuthorizer`). No new resource or permission. Takes effect on deploy; until then the route does not exist. |
| Data model | none |
| Documentation | `docs/openapi.yaml`, README (tables, examples, rules of thumb, known limitations, project tree), `docs/ARCHITECTURE.md` (F11, roadmap), Spanish references, specs index and roadmap row of 0000 |

## Acceptance criteria

- [ ] `PATCH /tasks/{id}` with `{ "done": true }` answers `200` with the full updated task (all six fields, `done: true`); an empty body, a blank `title` or a wrong type answers `400` with the `{ message, errors }` shape; `Content-Type` other than JSON answers `415`; malformed JSON answers `422`; a missing task and another user's task answer `404` with the same body.
- [ ] `PATCH` ignores `id`, `ownerId` and `createdAt` in the body, and changes only the fields sent.
- [ ] `PUT /tasks/{id}` request validation, status codes and bodies are unchanged; the existing `tests/updateTask.test.js` assertions pass unchanged (new assertions for headers are added, none edited).
- [ ] Every response of the `PUT` function, including `400`, `404`, `415`, `422` and `500`, carries `Deprecation: @<seconds>` and no `Sunset` header until Decision 3 provides a date; the `PATCH` function sends neither.
- [ ] `TaskRepository.update` documents and returns the updated task; `DynamoTaskRepository` and `InMemoryTaskRepository` both do, covered by tests.
- [ ] `docs/openapi.yaml` lints clean (`npx @redocly/cli lint docs/openapi.yaml`), contains `patchTask`, marks `updateTask` `deprecated: true`, and its `PATCH` examples match the real responses.
- [ ] `serverless.yml` has the `patchTask` function on `PATCH /tasks/{id}` with the Cognito authorizer, and no other change; its handler path resolves to an exported function.
- [ ] `scripts/smoke.sh` passes `bash -n`, checks `PATCH` own (`200`, returns the changed field) and foreign (`404`), and the `PUT` deprecation header.
- [ ] README, `docs/ARCHITECTURE.md` and the Spanish references describe `PATCH` first and `PUT` as deprecated, with matching structure in both languages.
- [ ] No idempotency code, table or header is present.
- [ ] `npm run lint` and `npm test` pass.

## Verification

```bash
npm run lint && npm test
npx @redocly/cli lint docs/openapi.yaml
grep -n "deprecated: true" docs/openapi.yaml                       # exactly one, under put
grep -n "operationId: patchTask" docs/openapi.yaml
git diff development -- serverless.yml | grep '^[+-] ' | grep -vi "patch\|patchTask"   # only the new function block
grep -rniE "idempoten" src serverless.yml                          # prints nothing
bash -n scripts/smoke.sh
```

After the maintainer deploys to `dev`: `STAGE=dev ./scripts/smoke.sh` passes, and `curl -si -X PUT ... "$API_URL/tasks/$id"` shows the `Deprecation` header.

## Commit plan

1. Add this spec (Draft, then Approved by the maintainer).
2. Return the updated task from `TaskRepository.update`, `DynamoTaskRepository`, the in-memory double and the `updateTask` use case, with tests (the `PUT` handler ignores it).
3. Add the `patchTask` handler with its tests.
4. Register the `patchTask` function in `serverless.yml`.
5. Add the `Deprecation` middleware to the `PUT` handler, with tests.
6. Document `PATCH` and deprecate `PUT` in `docs/openapi.yaml`.
7. Extend the smoke test.
8. Update README, ARCHITECTURE and the Spanish references, amend the roadmap row of step 11 (idempotency moved), close this spec.

## Risks and rollback

- **Risk:** CORS (spec 0013) rejects `PATCH` preflights if `PATCH` is missing from the allowed methods, which only matters once a browser calls it. Mitigated by listing `PATCH`, `Deprecation` and `Sunset` as requirements in 0013 and ordering the deploys sensibly (0013 is not required to merge first, since no browser client exists yet).
- **Risk:** clients ignore the deprecation. Accepted: signalling is advisory; removal is a later spec with a sunset date.
- **Risk:** a stale `Deprecation` date after a re-release. Mitigated by one constant in the middleware and a test that pins its format.
- **Risk:** the port change breaks a third repository implementation. None exists besides the Dynamo one and the test double, both updated in the same commit.
- **Rollback:** revert the merge and redeploy; the `patchTask` function and route disappear and `PUT` returns to its previous responses. No data is touched.

## Decisions to confirm

1. **Idempotency key leaves this step (recommended).** Default: this spec delivers `PATCH` and the deprecation only; a separate spec adds the key with its own table and retention, and the roadmap row of step 11 is amended accordingly. Alternative: keep it here, accept a larger pull request with a new table.
2. **`PATCH` returns the updated task (recommended)**, with the port change. Alternative: return `{ message }` like `PUT` and leave the port as it is (smaller, but the React client must re-fetch).
3. **Sunset date (recommended: none yet).** Send only `Deprecation` now; add `Sunset` when the maintainer commits to a removal date (suggested minimum: six months after the release containing this change).
4. **OpenAPI version bump (recommended: `1.2.0`).** An additive route is a minor release of the contract.
5. **Deprecation headers scope (recommended: every response of the `PUT` function).** Alternative: only the `200`.

# 0004: Standardize error responses behind one boundary

- **Status:** Draft
- **Branch:** `standardize-error-responses` (started from `development`)
- **Roadmap step:** 3 of [0000](0000-roadmap-to-layered-architecture.md)
- **Pull request:** to be filled when opened
- **Supersedes / depends on:** builds on [0003](0003-add-task-use-cases.md) (merged)

## Context

Each of the five task handlers has its own `try/catch` that turns errors into HTTP responses. The three rules are the same everywhere: a `TaskNotFoundError` is a `404`, an invalid pagination input is a `400`, and anything else is logged and answered with `500` and a fixed message. They are written five times, with small differences in quoting and layout, so a new error type or a change to logging has to be made in every handler, and one of them can be missed. Spec 0000 plans one error-mapping boundary (step 3) and leaves open whether the error body changes.

## Goal

Map domain and input errors to HTTP in exactly one place, remove the duplicated `try/catch` from the handlers, and keep every response identical.

## Decision: the error body does not change

The error shape stays `{ "message": "..." }`, and validation errors keep the extra `errors` list. Moving to RFC 9457 `application/problem+json` would be a breaking change for clients, and a React frontend is about to start consuming this contract. The maintainer chose to keep the current shape. Adopting problem details, if ever wanted, is a new spec with a versioning decision (roadmap: contract stability policy).

## Scope

1. **Boundary module** `src/handlers/errorBoundary.js` exporting `withErrorMapping(handler, { logLabel, failureMessage })`:
   - Wraps a handler function `(event, context) => response`.
   - Returns the handler's response untouched when it succeeds.
   - Maps `TaskNotFoundError` to `404 { message: "Task not found" }`.
   - Maps `InvalidPaginationError` and `InvalidCursorError` to `400 { message: <error message> }`.
   - Maps any other error to `500 { message: failureMessage }`, after logging `logLabel` and the error with `console.error`.
   - Holds the mapping as one table, so a new error type is one line.
2. **Handlers** (`addTask`, `getTask`, `getTasks`, `updateTask`, `deleteTask`) lose their `try/catch` and are wrapped with `withErrorMapping`, passing the same log label and failure message they use today. For handlers that read a JSON body, the boundary sits inside `withJsonBody`, so middleware errors (`415`, `422`, validation `400`) keep going through the existing middy error handling.
3. **Tests:** new unit tests for the boundary. The existing handler tests keep their assertions unchanged.

## Out of scope

- Any change to an error body, status code or message (the OpenAPI contract stays as it is).
- RFC 9457 problem details.
- Replacing the middy error handling of `withJsonBody` for `415`, `422` and validation errors.
- Structured logging, correlation ids and metrics: step 6.
- The `401` response, which API Gateway produces before any function runs.
- Moving `InvalidPaginationError` out of `src/handlers/pagination.js`.

## Design

```js
// src/handlers/errorBoundary.js
const MAPPED = [
    [TaskNotFoundError, () => ({ statusCode: 404, message: "Task not found" })],
    [InvalidCursorError, (error) => ({ statusCode: 400, message: error.message })],
    [InvalidPaginationError, (error) => ({ statusCode: 400, message: error.message })],
];

export const withErrorMapping = (handler, { logLabel, failureMessage }) =>
    async (event, context) => {
        try {
            return await handler(event, context);
        } catch (error) {
            // find in MAPPED, otherwise log and answer 500 with failureMessage
        }
    };
```

- A higher-order function, not a class or a framework: the handlers stay plain async functions and stay testable by calling them.
- The boundary lives in the HTTP adapter because turning an error into a status code is an HTTP concern. Domain and application code keep throwing typed errors and know nothing about status codes.
- The unknown-error path never leaks the error to the client: it logs it and returns the fixed message, as today.

Principles: SRP (handlers translate requests; one module translates errors), OCP (a new domain error is one table entry, no handler edited), DRY at the point where it removes five copies, KISS and YAGNI (no middleware framework for a table lookup).

Alternatives rejected: a middy `onError` middleware (the non-JSON handlers are not middy handlers, and the order of `onError` middlewares is subtle); a base handler class (adds inheritance for no gain).

One edge case changes: in `addTask`, `getOwnerId` is read before the `try`, so a missing claim (impossible behind the authorizer) would escape as a Lambda failure. Inside the boundary it becomes a logged `500`. This is the only behavior difference and it is not reachable through the API.

## Contract impact

| Area | Impact |
| --- | --- |
| Public API (`docs/openapi.yaml`) | none |
| Infrastructure (`serverless.yml`) | none |
| Data model | none |
| Documentation | `docs/ARCHITECTURE.md` (request lifecycle step 6, roadmap step 3, F11 note), this spec |

## Acceptance criteria

- [ ] The existing handler tests pass with their assertions unchanged, and no existing test file is modified.
- [ ] New boundary tests cover: success passes through untouched, `TaskNotFoundError` to 404, `InvalidCursorError` and `InvalidPaginationError` to 400 with their message, an unknown error to 500 with the fixed message and one `console.error` call with the label, the context argument is forwarded, and an error is never returned to the client verbatim.
- [ ] No handler contains a `try/catch`.
- [ ] `statusCode: 400`, `404` and `500` appear only in `src/handlers/errorBoundary.js` (success `200` and `201` stay in the handlers).
- [ ] `docs/openapi.yaml` and `serverless.yml` are unchanged.
- [ ] `npm run lint` and `npm test` pass.
- [ ] The pull request links this spec and states it matches it.

## Verification

```bash
npm run lint && npm test
git diff development --stat -- tests/addTask.test.js tests/getTask.test.js tests/getTasks.test.js tests/updateTask.test.js tests/deleteTask.test.js tests/pagination.test.js   # prints nothing
grep -n "catch" src/handlers/addTask.js src/handlers/getTask.js src/handlers/getTasks.js src/handlers/updateTask.js src/handlers/deleteTask.js   # prints nothing
grep -rn "statusCode: \(400\|404\|500\)" src/handlers | grep -v errorBoundary.js   # prints nothing
git diff development --stat -- docs/openapi.yaml serverless.yml   # prints nothing
```

## Commit plan

1. Add this spec (Draft, then Approved by the maintainer).
2. Add the error boundary and its tests (nothing uses it yet).
3. Wrap `addTask`, then `getTask`, `getTasks`, `updateTask` and `deleteTask`, one commit each, each leaving lint and tests green.
4. Close this spec and update the architecture notes.

## Risks and rollback

- **Risk:** a handler wrapped with the wrong label or failure message changes a response. Mitigated by the unchanged handler tests, which assert each status and message.
- **Risk:** the boundary placed outside `withJsonBody` would also catch middleware errors and change `415`, `422` and validation responses. Mitigated by placing it inside, and by the existing tests that cover those statuses.
- **Rollback:** revert the merge commit; the API and the data are unchanged.

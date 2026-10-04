# 0003: Add task use cases and thin handlers

- **Status:** Implemented
- **Branch:** `add-task-use-cases` (started from `development`)
- **Roadmap step:** 2 of [0000](0000-roadmap-to-layered-architecture.md)
- **Pull request:** [#20](https://github.com/Stilpz/aws-lambda-crud-nodejs/pull/20)
- **Supersedes / depends on:** builds on [0001](0001-extract-task-repository-port.md) (merged)

## Context

After spec 0001 the handlers no longer build DynamoDB requests, but they still decide what a task is: `addTask` generates the id and the timestamp and applies the defaults, and `getTask` decides that a missing task is a `404`. They import the infrastructure layer directly, so the dependency rule in spec 0000 (`handlers → application → domain`) is not yet true, and the business behavior can only be tested through HTTP events. Finding F9 in `docs/ARCHITECTURE.md` stays partly open until a use-case layer exists.

## Goal

Introduce the application layer (one use case per operation), make the handlers thin HTTP adapters that depend only on it, and group the HTTP adapter code under `src/handlers/`, without changing any observable behavior.

## Scope

1. **Application** (`src/application/`, imports only the domain):
   - One module per use case, each exporting a factory that receives its dependencies and returns an async function: `makeCreateTask`, `makeGetTask`, `makeListTasks`, `makeUpdateTask`, `makeDeleteTask`.
   - `createTask` builds the task: generates the id and `createdAt` through injected `generateId` and `now`, applies `description = ""` and `done = false`, sets `ownerId`, stores it and returns it.
   - `getTask` returns the task or throws `TaskNotFoundError` (a missing task and another user's task are the same case).
   - `listTasks`, `updateTask` and `deleteTask` call the repository with the owner and return its result or let `TaskNotFoundError` and `InvalidCursorError` propagate.
2. **Composition root:** `src/container.js` builds the single `DynamoTaskRepository` and the use cases with their real dependencies and exports them. It replaces `src/infrastructure/taskRepository.js`, which is deleted.
3. **Handlers** call the use cases from the container and map domain errors to the same HTTP responses as today (`TaskNotFoundError` to `404`, `InvalidCursorError` and `InvalidPaginationError` to `400`, anything else to `500`). A missing task in `getTask` is now reported through `TaskNotFoundError` like in `updateTask` and `deleteTask`.
4. **Layout:** the Lambda handlers and the HTTP adapter helpers (`auth.js`, `middleware.js`, `schemas.js`, `pagination.js`) move to `src/handlers/`. `serverless.yml` handler paths are updated to match.
5. **Tests:**
   - New use-case tests run against an in-memory `TaskRepository` test double (`tests/inMemoryTaskRepository.js`) with injected deterministic `generateId` and `now`.
   - The existing handler tests keep their assertions; they now act as regression tests through all layers. Only their import paths change.

## Out of scope

- A single error-mapping boundary and any change to error bodies: step 3 (`standardize-error-responses`). Handlers keep their local `try/catch`.
- Moving limit parsing or its default and maximum into the application layer: stays in `pagination.js` for now.
- Any change to the table, keys or index (step 5) or to `DynamoTaskRepository`.
- Contract tests shared between repository implementations and DynamoDB Local tests: step 7.
- Any change to `docs/openapi.yaml` or to HTTP behavior.
- A dependency-injection framework, base classes or event/command buses.

## Design

### Shape of a use case

```js
// src/application/createTask.js
export const makeCreateTask = ({ taskRepository, generateId, now }) =>
    async ({ ownerId, title, description = "" }) => {
        const task = { id: generateId(), ownerId, title, description, createdAt: now().toISOString(), done: false };
        await taskRepository.create(task);
        return task;
    };
```

Every use case takes one input object and returns plain data, so it knows nothing about HTTP, JWTs or events. The owner is always an explicit input, so a use case cannot be written without scoping.

### Dependency rule after this step

```
src/handlers  ──▶  src/container.js  ──▶  src/application  ──▶  src/domain
                          │
                          └──▶  src/infrastructure  (implements the repository port)
```

- `src/application` imports only `src/domain` (and JSDoc types).
- `src/handlers` import `src/application` types through the container and never import `src/infrastructure` or the AWS SDK.
- `src/container.js` is the only module that imports both the application and the infrastructure.

### Principles applied

- **SRP:** a handler translates HTTP to an input object and a result or error to HTTP; a use case holds the business step; the repository persists.
- **DIP and testability:** time and id generation are injected, so use-case tests are deterministic and need no AWS and no SDK stubs.
- **ISP:** a handler depends on exactly one use case, not on a wide service object.
- **OCP:** cross-cutting additions later (validation, events, idempotency) land in the use case without editing the handler or the repository.
- **KISS and YAGNI:** functions returning functions, no classes, no registry. A test double for the port, not a second production implementation.

### Alternatives rejected

- *Skipping the pass-through use cases (`listTasks`, `updateTask`, `deleteTask`) and letting handlers call the repository:* the handlers would depend on infrastructure for some operations and on the application for others, breaking the dependency rule and making later business rules a handler edit.
- *One `TaskService` class with five methods:* it forces every handler to depend on all five operations (ISP) and grows without bound.
- *Leaving the helpers where they are and moving only the handlers:* the HTTP adapter would be split across two directories; one directory per layer is the point of the roadmap.

## Contract impact

| Area | Impact |
| --- | --- |
| Public API (`docs/openapi.yaml`) | none |
| Infrastructure (`serverless.yml`) | only the six `handler:` paths change, from `src/<name>.<export>` to `src/handlers/<name>.<export>`; no resource, permission or route changes |
| Data model | none |
| Deployment | the new code takes effect only after a deploy, which must ship together with the new paths |
| Documentation | `docs/ARCHITECTURE.md` (layers, F9, roadmap step 2), README project tree, this spec |

## Acceptance criteria

- [x] The existing handler tests (`addTask`, `getTask`, `getTasks`, `updateTask`, `deleteTask`) and `pagination.test.js` pass with their assertions unchanged; only their import paths change.
- [x] New use-case tests cover each use case: creation defaults and generated fields, owner always passed to the repository, `TaskNotFoundError` for a missing and for another user's task, error propagation, and that `listTasks` passes limit and cursor through.
- [x] `src/application` imports only from `src/domain`.
- [x] No module under `src/handlers` imports `src/infrastructure` or `@aws-sdk/*`.
- [x] `src/infrastructure/taskRepository.js` no longer exists and no code references it (prose that describes its removal is fine).
- [x] Every `handler:` entry in `serverless.yml` resolves to an exported function (checked by the command below).
- [x] `git diff development -- serverless.yml` shows only the six `handler:` lines; `docs/openapi.yaml` is unchanged.
- [x] `npm run lint` and `npm test` pass.
- [x] The pull request links this spec and states it matches it (#20).

## Verification

```bash
npm run lint && npm test
grep -rn "from \"\.\./infrastructure\|@aws-sdk" src/handlers          # prints nothing
grep -rn "from \"\.\./\(handlers\|infrastructure\)" src/application   # prints nothing
git diff development --stat -- docs/openapi.yaml                      # prints nothing
git diff development -- serverless.yml | grep '^[+-] ' | grep -v handler:   # prints nothing
node scripts/check-handlers.mjs   # see Commit plan: resolves every handler path in serverless.yml (run once, not kept)
```

The last check is a throwaway script run from the scratchpad: it reads the `handler:` strings, imports each module with `TABLE_NAME` and `AWS_REGION` set, and asserts the named export is a function.

## Commit plan

1. Add this spec (Draft, then Approved by the maintainer).
2. Add the application use cases, the in-memory repository double and their tests (nothing uses them yet).
3. Add the composition root `src/container.js`.
4. Switch `addTask`, then `getTask`, `getTasks`, `updateTask` and `deleteTask` to the use cases, one commit each, each leaving lint and tests green.
5. Delete the old composition root `src/infrastructure/taskRepository.js`.
6. Move the handlers and HTTP helpers to `src/handlers/`, update `serverless.yml` handler paths and the test imports (a pure move).
7. Update the architecture notes and README tree, close this spec and the roadmap row.

## Risks and rollback

- **Risk:** a `handler:` path left pointing at a moved file would break a function at deploy time. Mitigated by the resolution check in the acceptance criteria, and by moving everything in a single commit.
- **Risk:** the move commit makes `git log` per file harder to follow. Mitigated by using `git mv` so history is preserved.
- **Risk:** behavior drift while rewriting `createTask`. Mitigated by the unchanged handler tests and by keeping the exact field set and the key order in the stored task.
- **Rollback:** revert the merge commit. Because the API and the data are unchanged, nothing else has to be undone; if it was already deployed, redeploy the previous version.

# 0001: Extract the task repository port

- **Status:** Implemented
- **Amendments:** 1 (see below)
- **Branch:** `extract-task-repository-port` (started from the `v1.0.0` tag, whose commit contains `development`)
- **Roadmap step:** 1 of [0000](0000-roadmap-to-layered-architecture.md)
- **Pull request:** to be filled when opened (branch `extract-task-repository-port`)
- **Supersedes / depends on:** none

## Context

Every handler calls DynamoDB directly: it builds `TableName`, keys, condition expressions, the index name and, for listing, the pagination cursor. Persistence details leak into HTTP code (finding F9 in `docs/ARCHITECTURE.md`), the same ownership condition is repeated in three handlers, and handlers can only be tested by stubbing the SDK client.

## Goal

Put all task persistence behind a `TaskRepository` port implemented by `DynamoTaskRepository`, make the handlers depend on that port, and change no observable behavior.

## Scope

1. **Domain** (`src/domain/`, imports nothing from other layers):
   - `errors.js`: `TaskNotFoundError` and `InvalidCursorError`.
   - `task.js`: the `Task` type (JSDoc) and `UPDATABLE_FIELDS`.
   - `taskRepository.js`: the port, documented with JSDoc (no runtime code).
2. **Infrastructure** (`src/infrastructure/`):
   - `dynamoClient.js`: the shared document client, moved from `src/db.js`.
   - `dynamoTaskRepository.js`: `DynamoTaskRepository`, constructed with `{ client, tableName }`. It is the only code that knows keys, condition expressions, the index name and the cursor format.
   - `taskRepository.js`: the composition root. Builds the single instance from `dynamoClient` and `process.env.TABLE_NAME`.
3. **Handlers** (`addTask`, `getTask`, `getTasks`, `updateTask`, `deleteTask`) call the port and map domain errors to the same HTTP responses as today. They no longer import the AWS SDK or the client.
4. **Pagination:** `src/pagination.js` keeps only the HTTP concern (parsing and validating `limit`) and passes the raw `nextToken` through. Cursor encoding and decoding move into the repository.
5. **Tests:** new repository tests using a fake client injected through the constructor. Handler tests keep their assertions. The cursor cases of `tests/pagination.test.js` move to the repository tests together with the logic they exercise.

## Out of scope

- Moving handlers into `src/handlers/` and `serverless.yml` handler paths: step 2.
- Use cases (`src/application/`) and injecting the repository into handlers: step 2.
- One error-mapping boundary and error body changes: step 3.
- Any change to the table, keys or index: step 5. The cursor token format stays `{ id, createdAt }`.
- DynamoDB Local integration tests: step 7.
- Any change to `serverless.yml`, `docs/openapi.yaml` or HTTP behavior.

## Design

### The port

```js
/**
 * @typedef {Object} TaskRepository
 * @property {(task: Task) => Promise<void>} create
 * @property {(ownerId: string, id: string) => Promise<Task | null>} findById
 * @property {(ownerId: string, options: { limit: number, cursor?: string }) =>
 *   Promise<{ items: Task[], nextCursor: string | null }>} listByOwner
 * @property {(ownerId: string, id: string, changes: Partial<Task>) => Promise<void>} update
 * @property {(ownerId: string, id: string) => Promise<void>} delete
 */
```

Behavior the port promises, which every implementation must honor:

- Every operation except `create` takes `ownerId`, so an owner-less query cannot be written by accident. A task that belongs to someone else is indistinguishable from a missing one: `findById` returns `null`, `update` and `delete` throw `TaskNotFoundError`.
- `listByOwner` returns the owner's tasks oldest first. `cursor` is an opaque string; a cursor that cannot be decoded throws `InvalidCursorError`. `nextCursor` is `null` when there are no more pages.
- `update` changes only fields listed in `UPDATABLE_FIELDS`; other keys in `changes` are ignored.
- Infrastructure failures propagate as the original error; the handler turns them into `500`.

### Principles applied

- **SRP:** a handler translates HTTP to a call and the result back; the repository translates a call to DynamoDB.
- **DIP:** `DynamoTaskRepository` receives its client and table name; nothing inside it reads the environment or constructs the SDK client.
- **OCP and LSP:** another store is another implementation of the same documented port.
- **ISP:** five small methods, one per access pattern in use.
- **KISS and YAGNI:** plain objects for tasks (no entity class), a JSDoc port instead of a runtime abstract class, no dependency-injection framework, no generic repository. The composition root is one tiny module.
- Ownership rules live in one place instead of three copies.

### Alternatives rejected

- *An abstract `TaskRepository` base class:* adds runtime code to document a contract JSDoc already states.
- *A generic `Repository<T>`:* there is one entity; generalizing is speculation.
- *Injecting the repository into handlers now:* that is the use-case work of step 2; here handlers import the composition root.

## Contract impact

| Area | Impact |
| --- | --- |
| Public API (`docs/openapi.yaml`) | none |
| Infrastructure (`serverless.yml`) | none |
| Data model | none: same keys, index, condition expressions and cursor format |
| Documentation | `docs/ARCHITECTURE.md` (progress on F9 and the structure), README project tree, this spec's status |

## Acceptance criteria

- [x] The existing handler tests (`addTask`, `getTask`, `getTasks`, `updateTask`, `deleteTask`) and the `limit` cases of `tests/pagination.test.js` pass with their assertions unchanged. The only other allowed edit in existing tests is the client import path in `tests/helpers.js`.
- [x] The cursor cases of `tests/pagination.test.js` (decoding, ignoring a smuggled owner, round trip, invalid tokens) are removed from that file because the logic moved; each one is covered by an equivalent test in `tests/dynamoTaskRepository.test.js`.
- [x] New `DynamoTaskRepository` tests cover each method: success, ownership mismatch, `TaskNotFoundError`, cursor round trip, `InvalidCursorError`, ignoring non-updatable fields, and propagation of infrastructure errors.
- [x] No file in `src/*.js` handlers imports `@aws-sdk/*` or the client; only `src/infrastructure/` does.
- [x] `src/domain/` imports nothing from `src/infrastructure/` or handlers.
- [x] The DynamoDB request parameters produced by each operation are identical to the current ones (proved by the unchanged handler tests plus the repository tests).
- [x] `git diff v1.0.0 -- serverless.yml docs/openapi.yaml` is empty.
- [x] `npm run lint` and `npm test` pass.
- [ ] The pull request links this spec and states it matches it (pending: the pull request is not opened yet).

## Verification

```bash
npm run lint && npm test
git diff v1.0.0 --stat -- serverless.yml docs/openapi.yaml            # must print nothing
grep -rn "@aws-sdk" src --include=*.js | grep -v "^src/infrastructure/"   # must print nothing
grep -rn "infrastructure" src/domain                                   # must print nothing
for f in addTask getTask getTasks updateTask deleteTask; do node --input-type=module -e "await import('./src/$f.js')" || echo "BROKEN $f"; done   # run with TABLE_NAME and AWS_REGION set
```

## Commit plan

1. Add the specs process, template, roadmap (spec 0000) and this spec (they link to each other, so they land together).
2. Add CLAUDE.md and AGENTS.md describing the spec-driven workflow.
3. Point the contributor docs, PR template and architecture notes at the specs.
4. Add the domain errors, task type and repository port.
5. Add `DynamoTaskRepository` and its tests.
6. Route the handlers through the repository, move cursor handling into it, and move the client under `src/infrastructure/`.
7. Mark this spec Implemented and update the architecture notes and README tree.

## Risks and rollback

- **Risk:** a subtle difference in the DynamoDB parameters. Mitigated by keeping the handler tests unchanged and asserting the exact `send` inputs in the repository tests.
- **Risk:** the cursor format drifts. Mitigated by a round-trip test and by asserting the decoded token equals `{ id, createdAt }`.
- **Risk:** removing cursor tests from `pagination.test.js` could lose coverage. Mitigated by the one-to-one mapping to repository tests listed in the acceptance criteria.
- **Rollback:** the change is internal and the API is unchanged, so reverting the merge commit restores the previous behavior with no data or infrastructure change.

## Amendments

1. **Cursor tests move with the cursor logic.** The first draft required all 65 existing tests to pass unchanged while also moving cursor encoding and decoding out of `src/pagination.js`. These contradict each other, because `tests/pagination.test.js` exercises that logic. Found while implementing; the maintainer chose to amend the spec so the cursor logic and its tests move together, rather than leave persistence details in the HTTP layer.

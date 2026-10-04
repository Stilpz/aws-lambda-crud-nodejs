# 0006: Redesign the task table keys

- **Status:** Approved
- **Amendments:** 1 (see below)
- **Branch:** `redesign-task-table-keys`, stacked on `migrate-orphan-task-owners` (step 4) because it edits the same specs index, roadmap table and README migration section; merge #21 and step 4 first
- **Roadmap step:** 5 of [0000](0000-roadmap-to-layered-architecture.md)
- **Pull request:** to be filled when opened
- **Supersedes / depends on:** builds on [0001](0001-extract-task-repository-port.md); makes the script of [0005](0005-migrate-orphan-task-owners.md) obsolete (see Decisions)

## Context

The table is keyed by `id` alone and listing goes through a global secondary index on `ownerId` and `createdAt`. That has three costs (findings F2 and F9, and the design notes in `docs/ARCHITECTURE.md`):

- The listing is **eventually consistent**: a task created a moment ago can be missing from `GET /tasks`, and clients must work around it.
- Ownership is **not part of the key**, so every single-item operation needs an extra condition or a post-read comparison, and an item without `ownerId` can exist (the orphans of spec 0005).
- A second index to pay for, maintain and grant permissions on.

## Goal

Key the table by the owner and the task id, so ownership is implicit in the key, listing becomes a strongly consistent query on the base table, and the secondary index disappears, without changing the public API contract.

## Decisions (maintainer to confirm when approving)

1. **Task ids become time-sortable UUIDs (version 7)** instead of random version 4. The sort key is the id, so listing is oldest first without a second attribute. A UUID version 7 is still a valid UUID, so `docs/openapi.yaml` (`format: uuid`) stays true. Ordering is by creation time to the millisecond; two tasks created by the same user in the same millisecond have no defined order.
2. **The table is replaced, not migrated.** Changing a key schema forces CloudFormation to create a new table. The new table gets a new name, `Tasks-<stage>` (CloudFormation cannot replace a table whose custom name stays the same), and the old `TaskTable-<stage>` is deleted by the deploy. Existing data in it is lost. The maintainer confirmed old records are disposable and only `dev` is deployed. A copy script is not built (YAGNI); if data ever needs to survive a key change, that is a new spec.
3. **The step 4 migration script is retired in this step.** The new key makes an item without an owner impossible and the old table disappears, so `npm run migrate:owners`, its tests and its README section are removed.

## Scope

1. **Key design:** partition key `ownerId`, sort key `id`; no secondary index. Table name `Tasks-${stage}`.
2. **Repository** (`DynamoTaskRepository`):
   - `create`: `PutItem`, guarded so an existing item with the same key is never overwritten.
   - `findById`: `GetItem` with `Key { ownerId, id }` and a consistent read.
   - `listByOwner`: `Query` on the base table with `ownerId = :ownerId` and a consistent read; `Limit` and the cursor as today. The cursor now holds only `{ id }`.
   - `update` and `delete`: the key includes `ownerId`, so another user's item can never match; the condition is just `attribute_exists(id)`.
3. **Id generation:** a small `generateUuidV7` in `src/infrastructure/uuidV7.js`, passed to `createTask` from the composition root (the use case already receives its id generator).
4. **Infrastructure:** `serverless.yml` table definition (new name, key schema, no index) and IAM (the `/index/*` resource is removed; the actions stay). The Lambda environment still exposes the name as `TABLE_NAME`.
5. **Retire** the step 4 script, its tests and its npm script and README section.
6. **Smoke test:** `scripts/smoke.sh` gains one check that a task is in the listing immediately after it is created, which is the visible benefit of the new design.
7. **Documentation:** README (table name, data model, consistency notes, deployment and cleanup), `docs/openapi.yaml` description (listing is now consistent), `docs/ARCHITECTURE.md` (access patterns, F2, roadmap), the Spanish references, and the migration notes for upgraders.

## Out of scope

- Any change to the port (`src/domain/taskRepository.js`), the use cases, the handlers or the HTTP behavior. They must not need to change.
- Copying data from the old table.
- Changing the public id format beyond version 7, or adding a `createdAt` sort.
- Observability, hardening (retention, point-in-time recovery, deletion protection): steps 6 and 9.
- Deploying. The maintainer deploys, following the README.

## Design

```
Before:  PK id        GSI ownerId + createdAt    listing: eventually consistent, extra index
After:   PK ownerId   SK id (UUID v7)            listing: Query on the table, consistent, no index
```

- Because `ownerId` is in every key, the ownership rule moves from conditions in the request to the shape of the key. A request can only address the caller's own partition.
- Each operation maps to a single, cheap, native access: `GetItem`, `Query`, `PutItem`, `UpdateItem`, `DeleteItem`.
- The port and the use cases already take `ownerId` on every call, which is why only the repository changes.
- Dependency rule unchanged: only `src/infrastructure/` knows the keys. The id generator is infrastructure, injected into the use case.
- KISS and YAGNI: a ten-line id generator instead of a dependency; no data copy tool for disposable data.

Alternatives rejected: keeping the secondary index and making it consistent (not possible: global secondary indexes are eventually consistent); a sort key of `createdAt#id` (a single-item read then needs the creation time as well, which the API does not carry); a ULID dependency (a version 7 UUID keeps the existing `uuid` format of the contract).

## Contract impact

| Area | Impact |
| --- | --- |
| Public API shape (`docs/openapi.yaml`) | none; only the consistency note changes, and ids stay UUIDs |
| Client-visible behavior | `GET /tasks` becomes strongly consistent; a `nextToken` issued before the deploy is rejected with 400; new task ids are version 7 UUIDs |
| Infrastructure | **breaking:** a new table `Tasks-<stage>` replaces `TaskTable-<stage>`; the old table and its data are deleted; the index and its IAM resource go away |
| Data | existing tasks are lost on deploy (approved for `dev`) |
| Dependencies | none |
| Documentation | README, OpenAPI description, ARCHITECTURE, Spanish references |

## Acceptance criteria

- [ ] The port file `src/domain/taskRepository.js`, the use cases in `src/application/` and the handlers in `src/handlers/` are unchanged.
- [ ] Repository tests assert, for every operation, the new requests: item keys carry `ownerId` and `id`; listing queries the base table with `ownerId = :ownerId`, a consistent read, the limit and a cursor holding only `id`; update and delete are conditioned on `attribute_exists(id)`; create cannot overwrite.
- [ ] No request refers to `IndexName` or `ownerId-createdAt-index` anywhere in `src`.
- [ ] `generateUuidV7` is tested: valid UUID format, version 7 and RFC 4122 variant, embedded timestamp matches the clock, ids from a later millisecond sort after earlier ones, and ids are unique.
- [ ] `createTask` receives the version 7 generator from the composition root.
- [ ] `serverless.yml`: no `GlobalSecondaryIndexes`, key schema `ownerId` (HASH) and `id` (RANGE), table name `Tasks-${sls:stage}`, no `/index/*` in IAM.
- [ ] The step 4 script, tests, npm script and README section are removed, and nothing references them.
- [ ] The existing handler and use-case tests that assert behavior still pass; tests that assert the table design are updated to the new requests, and each such change is justified in its commit message.
- [ ] `scripts/smoke.sh` checks that a freshly created task appears in the listing straight away, and `bash -n` accepts it.
- [ ] The README, OpenAPI description, ARCHITECTURE and the Spanish references describe the new design and the upgrade notes, with matching structure in both languages.
- [ ] `npm run lint` and `npm test` pass.
- [ ] The pull request links this spec and states it matches it.

## Verification

```bash
npm run lint && npm test
git diff <base> --stat -- src/domain src/application src/handlers      # prints nothing
grep -rn "IndexName\|ownerId-createdAt-index" src                      # prints nothing
grep -n "GlobalSecondaryIndexes\|/index/\*" serverless.yml             # prints nothing
grep -rn "migrate:owners\|orphanTaskOwners" . --include=*.js --include=*.json --include=*.md --exclude-dir=node_modules --exclude-dir=specs   # prints nothing
```

After the maintainer deploys to `dev`: `STAGE=dev ./scripts/smoke.sh` passes, and a task created and listed immediately appears in the listing (no eventual-consistency gap).

## Commit plan

1. Add this spec (Draft, then Approved by the maintainer).
2. Add the version 7 UUID generator with its tests.
3. Rekey the repository and update the tests that assert the table design.
4. Generate version 7 ids in the composition root.
5. Change the table definition and IAM in `serverless.yml`.
6. Retire the step 4 migration script.
7. Add the read-your-writes check to the smoke test.
8. Update the documentation and OpenAPI, close this spec.

## Risks and rollback

- **Risk:** deploying replaces the table and deletes its data. Mitigated by the maintainer's statement that `dev` data is disposable, by the fact that `staging` and `production` do not exist yet, and by documenting it in the upgrade notes. A stage with data that matters needs a copy first, in its own spec.
- **Risk:** code deployed before the infrastructure (or the reverse) fails at runtime. Mitigated by shipping both in the same deploy; there is no separate deployment of either.
- **Risk:** ids created in the same millisecond have no defined order. Accepted and documented; creation time to the millisecond is the ordering contract.
- **Risk:** the CloudFormation replacement fails if the table name stays the same. Mitigated by the new name `Tasks-<stage>`.
- **Rollback:** revert the merge and redeploy; CloudFormation creates the previous table again, empty. Data written to the new table is not carried back.

## Amendments

1. **The smoke test proves the consistency gain.** The first draft listed this as a post-deploy manual check under Verification but not in Scope. It is added to Scope and to the acceptance criteria so the check is repeatable and ships with the change. Found while preparing the verification.

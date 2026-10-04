# 0005: Migrate tasks that have no owner

- **Status:** Implemented
- **Branch:** `migrate-orphan-task-owners`, stacked on `standardize-error-responses` (PR #21) because both edit the specs index and the architecture roadmap table; merge #21 first
- **Roadmap step:** 4 of [0000](0000-roadmap-to-layered-architecture.md)
- **Pull request:** [#22](https://github.com/Stilpz/aws-lambda-crud-nodejs/pull/22)
- **Supersedes / depends on:** none in code; builds on the ownership model of [0001](0001-extract-task-repository-port.md)

## Context

Tasks created before ownership was introduced were stored without an `ownerId`. They are unreachable: the owner index never lists them and every read, update and delete is scoped to an owner, so they answer `404` forever and cannot be cleaned up through the API (finding F6). The maintainer confirmed that these old records can be modified or deleted, so there is no data to preserve.

## Goal

Provide a safe, repeatable maintenance script that either assigns an owner to every task without one, or deletes them, never touching a task that already has an owner.

## Scope

1. **Script** `scripts/migrate-orphan-task-owners.js`, a thin command line entry point, and its testable core in `scripts/orphanTaskOwners.js` (argument parsing and the migration itself).
2. **Arguments:**
   - Target table: `--stage <name>` (resolves to `TaskTable-<name>`) or `--table <name>`. Exactly one is required.
   - Region: `--region <region>`, defaulting to `AWS_REGION` and then `us-west-2`.
   - Action, exactly one: `--owner <sub>` assigns that owner (a UUID, the `sub` of a Cognito user), or `--delete` removes the orphans.
   - `--apply` performs the changes. **Without it the script is a dry run** that only reports what it would do.
3. **Behavior:**
   - Reads the table with a paginated `Scan` filtered by `attribute_not_exists(ownerId)`, projecting only `id`.
   - Assigns with an `UpdateItem`, or deletes with a `DeleteItem`, each guarded by `attribute_not_exists(ownerId)`, so an owner set by anyone in the meantime is never overwritten and a re-run is harmless.
   - A guarded write that finds an owner already present is counted as skipped. Any other failure is counted as failed and the run continues.
   - Prints the resolved table, region and action before doing anything, then a summary (found, changed, skipped, failed). The exit code is non-zero when any write failed.
4. **Convenience:** an `npm run migrate:owners` entry that runs the script.
5. **Tests:** unit tests for argument parsing and for the migration, using a fake client. No test reaches AWS.
6. **Documentation:** the README explains how to run it; the Spanish reference mirrors it.

## Out of scope

- Guessing the real owner of an old task. The maintainer chooses the owner or deletes.
- The data migration needed by the table key redesign: that belongs to step 5 and its own spec.
- Running the script against any real table as part of this change. The maintainer runs it.
- Any change to `src/`, `serverless.yml`, IAM or `docs/openapi.yaml`. The script uses the operator's own AWS credentials, not the Lambda role.
- Keeping the `scripts/` folder out of the Lambda deployment package (a packaging concern for roadmap step 10).

## Design

- **Safe by default.** Dry run unless `--apply` is given, and `--apply` still requires a table and an action. A typo cannot delete data silently.
- **Idempotent and non-destructive to owned data.** The `attribute_not_exists(ownerId)` condition is on every write, so the script can only ever change records that are still orphans.
- **Minimal reads.** The scan projects only the key; the write conditions do the safety work, so the scan filter is an optimization, not a trust boundary.
- **Testable core.** `migrateOrphanTasks({ client, tableName, action, apply, log })` receives its client and logger, like `DynamoTaskRepository`, so tests inject a fake and the CLI wires the real client.
- **KISS and YAGNI:** no interactive prompts, no config files, no concurrency or batching (the table is small; one item per request keeps conditional semantics simple and the code short).
- Owner validation: `--owner` must be a UUID, which is the form of a Cognito `sub`, so a mistyped email or name is rejected before any write.

Alternatives rejected: an AWS Lambda or a Serverless custom resource (a one-time operator task does not justify deployed infrastructure and IAM); a shell script with the AWS CLI (hard to test, easy to mis-quote, no pagination safety).

## Contract impact

| Area | Impact |
| --- | --- |
| Public API (`docs/openapi.yaml`) | none |
| Infrastructure (`serverless.yml`, IAM) | none |
| Data model | none; the script only fills in or removes records that lack `ownerId` |
| Dependencies | none; it uses the AWS SDK packages already installed |
| Documentation | README and its Spanish reference, `docs/ARCHITECTURE.md` (F6, roadmap step 4), this spec |

## Acceptance criteria

- [x] Argument parsing tests cover: a stage resolves to `TaskTable-<stage>`, an explicit table, the region precedence, dry run as the default, `--apply`, exactly one of stage or table, exactly one of `--owner` or `--delete`, an owner that is not a UUID, and unknown flags.
- [x] Migration tests cover: a dry run performs no write, assign and delete issue the guarded request for every orphan across more than one scan page, a guarded write that finds an owner is counted as skipped, any other failure is counted as failed without stopping the run, and the summary counts.
- [x] Every write sent by the migration carries `attribute_not_exists(ownerId)` (asserted).
- [x] The scan filters on `attribute_not_exists(ownerId)` and projects only `id` (asserted).
- [x] `src/`, `serverless.yml` and `docs/openapi.yaml` are unchanged.
- [x] `node scripts/migrate-orphan-task-owners.js --help` prints the usage and exits 0; running it with no arguments prints the usage and exits non-zero without contacting AWS.
- [x] `npm run lint` and `npm test` pass.
- [x] The pull request links this spec and states it matches it (#22).

## Verification

```bash
npm run lint && npm test
git diff standardize-error-responses --stat -- src serverless.yml docs/openapi.yaml   # prints nothing
node scripts/migrate-orphan-task-owners.js --help; echo "exit $?"                     # usage, exit 0
node scripts/migrate-orphan-task-owners.js; echo "exit $?"                            # usage, non-zero, no AWS call
```

Maintainer check against a real table (not part of the acceptance criteria): first a dry run, `npm run migrate:owners -- --stage dev --delete`, read the list, then repeat with `--apply`.

## Commit plan

1. Add this spec (Draft, then Approved by the maintainer).
2. Add argument parsing with its tests.
3. Add the migration core with its tests.
4. Add the command line entry point and the `npm run migrate:owners` script.
5. Document the script, close this spec and update the architecture notes.

## Risks and rollback

- **Risk:** deleting data by mistake. Mitigated by the dry-run default, a mandatory explicit action, the write condition, and the maintainer's statement that the old records are disposable.
- **Risk:** an assignment to the wrong owner. Mitigated by UUID validation and by printing the resolved owner, table and region before any write. Assigned records can still be corrected by deleting and recreating, since they are disposable.
- **Risk:** the script untested against AWS. Mitigated by tests with a fake client that assert the exact requests, and by running a dry run first.
- **Rollback:** the script changes no application code. Revert the merge; data already changed by a run is not restored by it.

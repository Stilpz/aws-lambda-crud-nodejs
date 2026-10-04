# 0007: Add CI quality gates

- **Status:** Approved
- **Branch:** `add-ci-quality-gates` (started from `development`)
- **Roadmap step:** 7 of [0000](0000-roadmap-to-layered-architecture.md)
- **Pull request:** to be filled when opened
- **Supersedes / depends on:** builds on [0006](0006-redesign-task-table-keys.md) (the table design the integration job exercises); [0008](0008-add-deploy-pipeline-oidc.md) depends on this spec

## Context

CI today is one job, `lint-and-test`, in `.github/workflows/ci.yml`: `npm ci`, `npm run lint`, `npm test`. It leaves five gaps:

- **No coverage measure.** `vitest.config.js` has no coverage provider and no threshold, so untested code can be merged without anyone noticing.
- **The API contract is not checked.** `docs/openapi.yaml` is edited by hand next to the README tables (AGENTS.md asks for `npx @redocly/cli lint docs/openapi.yaml` "when the API contract changes"), but nothing runs it.
- **No dependency audit.** Runtime dependencies (AWS SDK, middy, ajv) are not checked for known vulnerabilities.
- **`serverless.yml` is never validated.** A YAML or CloudFormation mistake is found at deploy time, on a real stage.
- **`DynamoTaskRepository` is only tested against a mocked client** (`tests/dynamoTaskRepository.test.js` asserts the exact requests). That proves the repository sends the requests we expect, not that DynamoDB accepts them and behaves as the port documents: a wrong condition expression, key schema or pagination cursor passes every test today. Spec 0006 moved all ownership and ordering guarantees into the key design, so this is the one place a real DynamoDB gives value.

The port also says (spec 0000, Liskov) that every `TaskRepository` implementation must honor the documented behavior "enforced by shared tests". Today the in-memory double (`tests/inMemoryTaskRepository.js`) and the Dynamo repository are each tested by their own, different tests, so nothing proves they agree.

## Goal

Make CI fail on untested code, an invalid API description, a vulnerable runtime dependency, an invalid `serverless.yml` and a repository that misbehaves against a real DynamoDB, with no AWS account or deploy involved for the checks that can run without one.

## Scope

1. **Coverage threshold.** Add `@vitest/coverage-v8` as a dev dependency (same major as vitest, see Design) and configure `test.coverage` in `vitest.config.js`: provider `v8`, `include: ["src/**"]`, reporters `text` and `json-summary`, and `thresholds` for lines, statements, functions and branches set from the measured baseline (see Decisions). Add `npm run test:coverage` (`vitest run --coverage`). CI runs it in place of the plain `npm test` step.
2. **OpenAPI lint.** Add `@redocly/cli` as a dev dependency and `npm run lint:api` (`redocly lint docs/openapi.yaml`). A `redocly.yaml` is added only if the default `recommended` ruleset reports findings that the maintainer chooses to relax; each relaxed rule is justified in a comment. Findings that are real defects in `docs/openapi.yaml` are fixed in the same commit (documentation only, no contract change).
3. **Dependency audit.** `npm audit --omit=dev --audit-level=high` as a CI step (exposed as `npm run audit:prod`). It gates on runtime dependencies only; dev-tool advisories do not block a release.
4. **Template validation.** A CI job that runs `serverless package --stage ci` (builds the CloudFormation template without deploying) and then `cfn-lint` on the generated `.serverless/cloudformation-template-update-stack.json`. See Design for what is and is not verified without AWS credentials.
5. **Repository contract suite.** Extract the behavior the port documents into `tests/taskRepositoryContract.js`, a function `describeTaskRepositoryContract(name, createRepository)` that registers Vitest cases, and run it against `InMemoryTaskRepository` from a new unit test file. The cases cover: `create` stores and never overwrites; `findById` returns `null` for a missing task and for another owner's task; `listByOwner` returns only the owner's tasks, oldest first, paginates with `limit` and an opaque cursor until `nextCursor` is `null`, and rejects a garbage cursor with `InvalidCursorError`; `update` changes only `UPDATABLE_FIELDS` and rejects with `TaskNotFoundError` for missing and foreign tasks; `delete` likewise.
6. **DynamoDB Local integration tests.** `tests/integration/dynamoTaskRepository.integration.test.js` runs the same contract suite against `DynamoTaskRepository` backed by a real DynamoDB Local, using the real AWS SDK client pointed at an endpoint taken from `DYNAMODB_ENDPOINT`. A `vitest.integration.config.js` includes only `tests/integration/**`, and `npm run test:integration` runs it. The default `npm test` and `npm run test:coverage` exclude the integration folder, so local `npm test` still needs no network, no Docker and no AWS, as AGENTS.md requires. Integration tests also assert the Dynamo-specific guarantees the double cannot show: keys are `{ ownerId, id }`, listing is strongly consistent (a task is listed right after `create`), a cursor from another owner's listing cannot expose that owner's tasks, and a second `create` with the same key leaves the first item untouched.
7. **CI wiring.** `.github/workflows/ci.yml` gains jobs: `lint-and-test` (adds coverage and `lint:api` and the audit as steps or separate jobs, see Design), `validate-template`, and `integration-test` with a DynamoDB Local service container. Third-party actions are pinned to a major version tag as the existing workflow does.
8. **Documentation.** README testing and CI sections, `CONTRIBUTING.md` (commands before a pull request), `docs/ARCHITECTURE.md` (test strategy, roadmap row), the AGENTS.md command list, and the Spanish references.

## Out of scope

- Deploying, AWS credentials or OIDC in CI: step 8 ([0008](0008-add-deploy-pipeline-oidc.md)). The jobs here use no AWS credentials.
- Making the new jobs required status checks. That is a repository setting; the maintainer changes it after the first green run (see Risks).
- Handler or end-to-end HTTP tests against DynamoDB Local (the handlers are covered by the unit tests; the smoke test covers the deployed stack).
- Mutation testing, coverage upload to a service, badges, dependency update bots, SAST, secret scanning.
- Any change to `src/`. If an integration test finds a defect, the fix is a new spec.
- Replacing the mocked unit tests in `tests/dynamoTaskRepository.test.js`. They keep asserting the exact requests and stay unchanged (behavior-preserving rule).

## Design

### Coverage

`@vitest/coverage-v8` is versioned in lockstep with vitest: `npm view @vitest/coverage-v8@5.0.2 peerDependencies` reports `vitest: 5.0.2` (exact), and the registry's latest of both packages is `5.0.3`. The repository has vitest `^5.0.2` locked at 5.0.2. The implementation must install both in one command (`npm install -D vitest@^5.0.2 @vitest/coverage-v8@^5.0.2`) so the lockfile resolves them to the same version and `npm ci` does not hit a peer-dependency error; a vitest bump from 5.0.2 to 5.0.3 in the lockfile is expected and acceptable. v8 coverage needs no Babel step and works on Node 24.

`coverage.include: ["src/**"]` matters: without it, files no test imports are silently absent from the report and the threshold cannot fail for them. Thresholds are a ratchet: set at the measured baseline rounded down, never lowered without a spec amendment.

Rejected: Istanbul provider (extra instrumentation, slower, no benefit here); a per-file threshold (noisy, YAGNI); uploading to Codecov or similar (a third-party service for no present need).

### OpenAPI lint

`@redocly/cli` 2.57.0 is the registry latest (`engines: node >=22.12.0 || >=20.19.0 <21`, satisfied by the Node 24 used in CI and the repo's `engines >=22`). It is a dev dependency so the version is locked and `npm ci` reproduces it, instead of `npx` fetching whatever is latest on each run (AGENTS.md already mentions the `npx` form; that line is updated to `npm run lint:api`). The cost is a large dev dependency tree; accepted because it is dev-only and removed from the audited graph (the audit uses `--omit=dev`). Rejected: `npx` at run time (not reproducible, network at every run); Spectral (a second tool with its own ruleset for the same job).

### Dependency audit

`npm audit` queries the registry's advisory database, needs no credentials and no AWS. `--omit=dev` plus `--audit-level=high` blocks on high and critical advisories in what ships to Lambda. Because advisories appear without any change in the repository, an audit that blocks every pull request can fail for reasons unrelated to the change; to contain that, the audit is its own job, so it is visible and separable, and it also runs on a weekly `schedule`. Rejected: `audit-ci` (an extra dependency for an allowlist feature we do not need yet, YAGNI); auditing dev dependencies as blocking (lint and test tooling does not run in production).

### Template validation: what can be checked without AWS

Facts and assumptions, to be confirmed by the first implementation commit (the spec is amended if they are wrong):

- Serverless Framework v4 is not a plain open source CLI: it needs authentication (`serverless login`, or the `SERVERLESS_ACCESS_KEY` environment variable from the dashboard of org `stivencardona`, which `serverless.yml` names) for commands that run the framework. This holds in CI too and is independent of AWS credentials. **Assumption to verify:** `serverless package` and `serverless print` work with the access key and no AWS credentials, because they resolve `serverless.yml` and build the template locally; `serverless.yml` here uses only `${sls:stage}` and CloudFormation intrinsics (`!Ref`, `!GetAtt`, `!Join`, `!Sub`), no `${ssm:...}`, `${aws:...}` or `${cf:...}` variables that need the account.
- Therefore `validate-template` needs one repository secret, `SERVERLESS_ACCESS_KEY`. Secrets are not exposed to pull requests from forks, so the job is skipped (not failed) when the secret is empty. A `serverless package` run needs no AWS access, so no AWS secret is added.
- `serverless print` only proves the YAML and variables resolve. `serverless package` also proves the framework can compile functions and events into a CloudFormation template. `cfn-lint` then checks that template against the CloudFormation resource specification (wrong property names, bad intrinsic use, `Ref` to a missing resource), which neither Serverless command does. `aws cloudformation validate-template` is rejected because it needs AWS credentials and only checks syntax.
- A fallback that needs no Serverless account at all, if the maintainer does not want the key in CI: `cfn-lint` cannot read `serverless.yml` directly (it holds the Serverless `functions:` section, not only CloudFormation). A lighter option is a Vitest test that parses `serverless.yml` and asserts the invariants the repository already documents (table key schema, no secondary index, IAM action list). It needs a YAML parser dependency with CloudFormation tag support, so it is not chosen as the default (see Decisions).

`cfn-lint` is installed with `pip install cfn-lint==<pinned version>` in the job (Python is on the GitHub-hosted runner). The version is pinned at implementation time from `pip index versions cfn-lint`; it is not guessed here. The Serverless Framework version used is pinned in the workflow in one `env` value (the registry latest at the time of writing is 4.43.0; `serverless.yml` declares `frameworkVersion: "4"`), invoked through `npx --yes serverless@<version>`, so the CI template check and, later, the deploy in 0008 use the same version.

### DynamoDB Local in GitHub Actions

GitHub Actions runs service containers next to the job: `services: dynamodb: image: amazon/dynamodb-local:<pinned tag>`, `ports: ["8000:8000"]`. The default command of the image starts DynamoDB Local on port 8000, so no override is needed (an `options` health check is added so the job waits for it). Because the job runs directly on the runner, the endpoint is `http://localhost:8000`. DynamoDB Local requires some credentials and a region but does not validate them; the job sets `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_REGION` to dummy alphanumeric values (DynamoDB Local 2.0.0 and later accepts only letters and digits in the key id). These are public test values, not secrets. The image tag is pinned to a specific version chosen at implementation from Docker Hub, never `latest`.

Locally the same suite runs with `docker run -p 8000:8000 amazon/dynamodb-local` and `DYNAMODB_ENDPOINT=http://localhost:8000 npm run test:integration`. If `DYNAMODB_ENDPOINT` is not set, `test:integration` fails with a clear message instead of reaching a real AWS account. This is the guard that keeps "tests never reach AWS" true: the integration client is built only from `DYNAMODB_ENDPOINT`, with dummy credentials set in the test setup file, so a developer with real credentials in their shell cannot hit a real table by accident.

Test isolation: each test file creates its own table with a unique name (for example `Tasks-it-<random>`) in a `beforeAll`, using the key schema of `serverless.yml` (`ownerId` HASH, `id` RANGE, on-demand billing), and each contract case uses fresh owner ids so cases do not see each other's data. The table is deleted in `afterAll`. The key schema is duplicated between `serverless.yml` and the test helper; this is accepted and mitigated by a short comment naming `serverless.yml` as the source and by the Dynamo-specific tests, which fail if the repository's keys and the table disagree. Rejected: parsing `serverless.yml` to build the table (adds a YAML-with-CloudFormation-tags dependency for one ten-line definition).

Alternatives to DynamoDB Local, rejected: `dynalite` (an emulator that tracks the real service less closely; its registry latest is 4.0.0, but DynamoDB Local is the AWS-provided implementation); Testcontainers (a dependency and a Docker-in-test model, when the Actions service container does the job); a real `Tasks-ci` table in an AWS account (needs credentials, costs money, and is step 8's territory).

Known limits of DynamoDB Local, written down so nobody over-trusts it: it does not enforce provisioned throughput or throttling and has no real eventual consistency, so it cannot detect a missing `ConsistentRead`. The unit tests keep asserting `ConsistentRead: true`; the integration tests prove the semantics that are visible locally.

### Shared contract suite across both implementations

Worth it, for three reasons that exist today and not hypothetically: the roadmap already promises "shared tests" for Liskov; the use-case tests trust the in-memory double, so a double that drifts from the real repository makes those tests lie; and the suite is small (the port has five operations). The contract runs with the double on every `npm test` and with DynamoDB Local in the integration job.

Known differences the contract must tolerate and must not paper over:

- **Ordering.** The double sorts by `createdAt` then `id`; Dynamo orders by the sort key `id`. The contract builds tasks with ids from `generateUuidV7` in increasing millisecond order, so both orders agree, and it asserts only "oldest first" through that. This is also the real-world rule.
- **Cursor format.** The two implementations encode cursors differently. The contract treats it as opaque: it only passes back the `nextCursor` it received, and asserts that a non-decodable string rejects with `InvalidCursorError`.
- **Duplicate `create`.** The port says "never overwrites" but names no error. The double throws a plain `Error`, Dynamo rejects with `ConditionalCheckFailedException`. The contract asserts only that `create` rejects and the stored task is unchanged. Naming a typed error in the port would be a separate decision (see Out of scope; it needs its own spec).

If the contract exposes a real disagreement between the double and the repository, the double is fixed (it is test code) in the commit that introduces the contract; a defect in `src/` stops the work and becomes its own spec (AGENTS.md: if reality disagrees with the spec, stop).

### Job layout in the workflow

One workflow, parallel jobs, each short and with one reason to fail: `lint-and-test` (lint, coverage), `openapi-lint`, `audit`, `validate-template`, `integration-test`. Parallel jobs share the same checkout, `setup-node` with npm cache, and `npm ci`, which is duplicated (five lines) rather than extracted into a composite action: a helper is extracted on its third use, and here a reusable step would add a file for five lines. The workflow gets `permissions: contents: read` at the top level (least privilege, and a precondition for 0008).

### Principles applied

- **KISS and YAGNI:** native `npm audit`, an Actions service container, dev dependencies only where a tool is needed; no coverage service, no Testcontainers, no composite action, no YAML parsing dependency.
- **SOLID (Liskov):** one contract suite is the executable definition of the port; both implementations must pass it.
- **Clean Code:** the contract file is named after what it asserts and exports one function; cases state behavior ("never returns another owner's task"), not requests.
- **Tests only where they add information:** the mocked tests assert requests; integration tests assert behavior against a real engine; neither replaces the other.

## Contract impact

| Area | Impact |
| --- | --- |
| Public API (`docs/openapi.yaml`) | none to behavior; possible description fixes if the linter finds defects |
| Infrastructure (`serverless.yml`) | none |
| Data model | none (the integration tables are created and deleted by the tests in DynamoDB Local) |
| Dependencies | dev only: `@vitest/coverage-v8`, `@redocly/cli`; `vitest` lockfile bump to the matching version; `cfn-lint` (pip, CI only); no runtime dependency change |
| CI / repository settings | new jobs; new repository secret `SERVERLESS_ACCESS_KEY` for `validate-template`; the maintainer may add the jobs as required checks |
| Documentation | README, CONTRIBUTING, `docs/ARCHITECTURE.md`, AGENTS.md command list, Spanish references |

## Acceptance criteria

- [ ] `npm run test:coverage` passes and enforces thresholds on `src/**`; lowering any covered line below the threshold (demonstrated once by temporarily skipping a test) makes the command exit non-zero.
- [ ] `@vitest/coverage-v8` and `vitest` resolve to the same version in `package-lock.json`, and `npm ci` succeeds on a clean checkout.
- [ ] `npm run lint:api` exits 0 on `docs/openapi.yaml`, and breaking the file (for example removing a required `operationId`) makes it fail.
- [ ] `npm run audit:prod` runs in CI, exits non-zero on a high or critical advisory in a runtime dependency, and ignores dev dependencies.
- [ ] The `validate-template` job builds the template and runs `cfn-lint` on it with no AWS credentials in the job; an intentional typo in a resource property of `serverless.yml` makes it fail. The assumption that `serverless package` needs no AWS credentials is confirmed or the spec is amended.
- [ ] `tests/taskRepositoryContract.js` runs against `InMemoryTaskRepository` in `npm test`, and the existing tests are unchanged (git diff shows only additions under `tests/`, apart from the in-memory double if the contract finds a drift, justified in its commit message).
- [ ] `npm run test:integration` passes against DynamoDB Local with the same contract suite plus the Dynamo-specific cases, and fails fast with a clear message when `DYNAMODB_ENDPOINT` is unset.
- [ ] `npm test` still needs no Docker, network or AWS credentials and does not run the integration folder.
- [ ] The `integration-test` job uses a pinned `amazon/dynamodb-local` tag and passes on a pull request.
- [ ] `.github/workflows/ci.yml` declares `permissions: contents: read` and every action is pinned to a major version.
- [ ] No file under `src/` changed.
- [ ] README, CONTRIBUTING, ARCHITECTURE, AGENTS.md and the Spanish references document the new commands and jobs, with matching structure in both languages.
- [ ] `npm run lint` and `npm test` pass.

## Verification

```bash
npm ci && npm run lint && npm test
npm run test:coverage                       # prints the table; exit code 0
npm run lint:api
npm run audit:prod
git diff development --stat -- src          # prints nothing
git diff development --stat -- tests | grep -v "^ tests/\(integration\|taskRepositoryContract\)" # only new files, plus the justified double change
docker run -d --rm -p 8000:8000 amazon/dynamodb-local:<pinned tag>
DYNAMODB_ENDPOINT=http://localhost:8000 npm run test:integration
env -u DYNAMODB_ENDPOINT npm run test:integration   # fails with the clear message
```

In GitHub: open the pull request and confirm every job is green; push a throwaway commit that breaks one input per gate (a threshold, the OpenAPI file, `serverless.yml`, a repository condition expression) and confirm the matching job goes red, then drop it. Locally, `serverless package --stage ci` with `SERVERLESS_ACCESS_KEY` set and `AWS_*` variables unset, followed by `cfn-lint .serverless/cloudformation-template-update-stack.json`, proves the template job's steps.

## Commit plan

1. Add this spec (Draft, then Approved by the maintainer).
2. Enforce a coverage threshold: dev dependency, `vitest.config.js`, `test:coverage`, CI step (thresholds from the measured baseline, recorded in the message).
3. Lint the OpenAPI description in CI: dev dependency, `lint:api`, CI job, fixes to `docs/openapi.yaml` if the linter finds defects.
4. Audit runtime dependencies in CI: `audit:prod`, job, weekly schedule.
5. Validate the Serverless template in CI: `validate-template` job with `serverless package` and `cfn-lint`, pinned versions, secret documented.
6. Extract the repository contract suite and run it against the in-memory double (tests only).
7. Add the DynamoDB Local integration tests: integration config, helper, tests, `test:integration`, endpoint guard.
8. Run the integration tests in CI with a DynamoDB Local service container; add workflow `permissions`.
9. Document the quality gates (README, CONTRIBUTING, ARCHITECTURE, AGENTS.md, Spanish references) and close this spec.

Each commit leaves `npm run lint` and `npm test` green.

## Risks and rollback

- **Risk:** the audit starts failing because of a new advisory unrelated to a change, blocking merges. Mitigation: it is a separate job, the maintainer decides whether to mark it required, and the fix is a dependency bump; an advisory with no fix can be waived by a spec amendment, not silently.
- **Risk:** the `serverless package` assumption is wrong (it may need AWS credentials or may require interactive login). Mitigation: verified in commit 5 before the job is added; if wrong, the amendment replaces it with `serverless print` plus cfn-lint on a hand-built check, or drops cfn-lint and keeps the YAML-invariants test.
- **Risk:** a Serverless access key in CI is a long-lived secret, which 0008 tries to avoid for AWS. It grants framework access for the org, not AWS access. Stored as an Actions secret, rotated from the dashboard; scoped narrowly if the dashboard allows.
- **Risk:** the thresholds are too tight and block a legitimate change, or too loose and never bite. Mitigation: set from the measured baseline, documented as a ratchet; changes need a justified commit.
- **Risk:** DynamoDB Local drifts from the real service, giving false confidence. Mitigation: limits are documented; the smoke test after real deploys remains the final check.
- **Risk:** integration flakiness from container startup. Mitigation: a health check on the service container and table creation waiting for `ACTIVE`.
- **Risk:** new checks run on the same pull request that adds them and cannot be required until they exist on `development`. The maintainer adds them to branch protection after merge.
- **Rollback:** revert the merge. Everything here is CI configuration, dev dependencies and tests; no deployed resource, runtime dependency or `src/` file changes, so rollback has no operational effect.

## Decisions to confirm

1. **Coverage thresholds:** measure the baseline in commit 2 and set each metric to the measured value rounded down to the nearest 5, never below 80. *Recommended default.* Alternative: a fixed 80 everywhere.
2. **Template validation needs the `SERVERLESS_ACCESS_KEY` secret** and runs `serverless package` plus `cfn-lint`; skipped on fork pull requests. *Recommended.* Alternative: no secret, a Vitest test of `serverless.yml` invariants with a YAML parser dependency.
3. **Audit scope:** runtime dependencies only, `--audit-level=high`, as a separate job that also runs weekly. *Recommended.* Alternative: all dependencies, or `moderate`.
4. **Shared contract suite** run against both implementations, with the double fixed if it drifts. *Recommended.* Alternative: integration tests only, with no shared suite.
5. **Make the new jobs required checks** after the first green run (a repository setting, done by the maintainer, not by this change). *Recommended.*

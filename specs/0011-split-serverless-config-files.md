# 0011: Split serverless.yml into resources and functions files

- **Status:** Implemented
- **Branch:** `split-serverless-config-files` (started from `development`)
- **Roadmap step:** 10 of [0000](0000-roadmap-to-layered-architecture.md)
- **Pull request:** [#28](https://github.com/Stilpz/aws-lambda-crud-nodejs/pull/28), merged into `development`
- **Supersedes / depends on:** none. Behavior-preserving: it must work whether it lands before or after [0009](0009-add-observability-with-powertools.md) and [0010](0010-harden-production-resources.md); the recommended order is first (see Decisions), because both of those, and the CORS and SPA client specs, add to this file

## Context

`serverless.yml` is one 130-line file holding the provider, six functions, a DynamoDB table, a Cognito user pool, an app client and the outputs. It is still readable, but four pending specs add to it: observability (an SNS topic, three alarms, parameters), hardening (profile parameters, per-function IAM, throttling, auth flows), CORS and the SPA app client. After them it would be several hundred lines where a function's route, its IAM statement and an unrelated alarm sit in one file, every spec edits the same regions, and merges between those branches conflict.

Facts checked while writing this spec, all with a throwaway copy of this repository's configuration and the Serverless Framework v4 CLI (no credentials needed for `print` and `package`):

- `functions:` and `resources:` accept a list of `${file(./path.yml)}` includes; the files are merged into one object. Paths are relative to the service directory.
- Each included file can hold one function (a map with one key) or a `Resources:` and an `Outputs:` section; two files with different `Resources` keys merge.
- The CloudFormation short forms (`!Ref`, `!GetAtt`, `!Join`) work inside included files, and references across files (a function file is not needed to know the table; `provider.environment` refers to `TaskTable` defined in another file) resolve.
- `${sls:stage}`, `${param:...}` and `${self:...}` resolve inside included files the same as in the root file.
- Splitting this repository's configuration into `functions/` (six files) and `resources/` (two files) with the provider, `org`, `service` and `frameworkVersion` left in `serverless.yml` printed byte-identical output to the single file for `--stage dev` and `--stage staging` (`fc` found no differences), and the packaged CloudFormation templates were equal after ignoring the values that change on every build (artifact keys, code hashes, version hashes).

## Goal

Move the functions and the resources into separate files, one concern per file, with no change to what Serverless resolves or deploys.

## Scope

1. **Layout** (all paths relative to the repository root):

   ```
   serverless.yml            # org, service, frameworkVersion, provider, and the includes below
   functions/
     hello.yml
     createTask.yml
     getTasks.yml
     getTask.yml
     updateTask.yml
     deleteTask.yml
   resources/
     table.yml               # TaskTable
     auth.yml                # UserPool, UserPoolClient and the stack Outputs
   ```

2. **Root file**: `functions:` and `resources:` become lists of `${file(...)}` includes, in the current order (`hello`, `createTask`, `getTasks`, `getTask`, `updateTask`, `deleteTask`; table, then auth). The `provider` block and the explanatory comments on `org` and `service` stay where they are.
3. **Function files**: each holds exactly one function definition, moved verbatim (handler path, events, authorizer reference).
4. **Resource files**: `table.yml` holds `TaskTable` under `Resources:`; `auth.yml` holds `UserPool` and `UserPoolClient` under `Resources:` and the two `Outputs`. Contents moved verbatim.
5. **Documentation**: README (Project Structure tree, the "Configuration for Forks" table still points at `serverless.yml` for `org`, `service` and `provider.region`, which have not moved), `CONTRIBUTING.md` and `AGENTS.md` where they name `serverless.yml` as the home of functions or resources, `docs/ARCHITECTURE.md`, the Spanish references.

## Out of scope

- Any change to what is deployed: no property, name, order of events, value or comment-sensitive behavior changes. No renames of functions, logical ids or files that the handlers reference.
- Moving the `provider` block (it is short, holds the authorizer and environment, and is the file a fork edits first). Revisit if it grows after the other specs.
- A JavaScript or TypeScript configuration file (`serverless.js`, `.ts`), YAML anchors across files, or a custom plugin.
- Per-function IAM, alarms, throttling, parameters and CORS: they land in the new files through their own specs, not here.
- Reducing the packaged zip (classic packaging already includes `docs/`, `specs/` and `tests/`; adding a few small YAML files changes nothing material). Package patterns would be their own spec.
- Deploying. The maintainer deploys, following the README.

## Design

```
serverless.yml  --includes-->  functions/*.yml   (one function each)
                --includes-->  resources/*.yml   (one concern each)
Serverless resolves the includes, merges them, and prints / packages the same configuration.
```

- **One function per file.** A function's handler, routes and (after 0010) its IAM statement change together and are what a reader looks for by name; six short files remove the shared-region conflicts between feature branches. Grouping the five task functions into `functions/tasks.yml` was rejected: the file would be edited by every route spec, and by every IAM change in 0010.
- **Resources by concern, not by type.** `table.yml` (data) and `auth.yml` (identity, with the outputs that expose it) match how the pieces change. Alarms and the topic from 0009 will be `resources/observability.yml`; this spec does not create it. The Outputs sit next to the resources they export, so the root file has no `Outputs`.
- **Provider stays.** It references resources by logical id (`!Ref UserPool`, `!Ref TaskTable`); that works across files, so no coupling is introduced.
- **Why `${file()}` lists and not `<<:` or JavaScript.** Lists of includes are the documented, tested form here (verified), keep everything plain YAML, and need no code.
- **Behavior-preserving, so proof is a diff.** The resolved configuration is the contract; the repository tests do not touch `serverless.yml` and are unaffected. The proof is that `serverless print` is identical before and after, for several stages, and that the packaged CloudFormation template is equivalent. Both are defined below and are the acceptance criteria.

Principles: SRP (one concern per file), OCP (a new function or resource is a new file and one include line, with no edits in the middle of existing files), KISS (YAML includes, no tooling), YAGNI (provider not split, no generated config).

Alternatives rejected: a single file with comment banners (does not remove the merge conflicts); a `serverless.js` assembling the pieces (adds code to review for a declarative need); a plugin that discovers files (a dependency for six includes).

## Contract impact

| Area | Impact |
| --- | --- |
| Public API (`docs/openapi.yaml`) | none |
| Client-visible behavior | none |
| Infrastructure | none by construction: identical resolved configuration and equivalent CloudFormation template; a deploy after this change is a no-op for CloudFormation. Eight new small files and a smaller root file |
| Data model | none |
| Dependencies | none |
| Documentation | README project structure, CONTRIBUTING and AGENTS file references, `docs/ARCHITECTURE.md`, Spanish references, this spec |

## Acceptance criteria

- [x] For `--stage dev`, `--stage staging`, `--stage prod` and an unlisted stage such as `feature-x`, the output of `serverless print` on the branch is byte-identical to the output on the base commit (the `development` commit the branch started from, or the latest merged spec 0009 or 0010 if it landed first). The `diff` of each pair prints nothing.
- [x] The packaged CloudFormation templates for `dev` and `prod` are equal after normalization: Lambda version resources, function `Code`, and the deployment bucket outputs are ignored (they change on every build). The comparison script reports `templates equal`.
- [x] The root `serverless.yml` contains no function definition and no resource definition, only `org`, `service`, `frameworkVersion`, `provider` (and, if present by then, `stages` and `custom`) and the two include lists.
- [x] The six function files each define exactly one function; `functions/*.yml` together contain exactly the six function names that `serverless print` lists.
- [x] `git diff` of every moved block shows only a move (no property change): `git diff --stat -M` after the move shows the files as renames or pure additions equal in content to the removed lines, checked by the print comparison above.
- [x] No file under `src/`, `tests/`, `scripts/` or `docs/openapi.yaml` changes.
- [x] README, CONTRIBUTING, AGENTS and ARCHITECTURE describe the new layout and the "add a function or a resource" steps, with matching structure in the Spanish files.
- [x] `npm run lint` and `npm test` pass.

## Verification

Capture the baseline on the base commit and the result on the branch, then diff. Run from the repository root with the Serverless Framework CLI available (no AWS credentials are needed for `print` and `package`; run `npm ci` first so classic packaging has its dependencies):

```bash
BASE=development          # or the commit the branch started from
mkdir -p /tmp/split-check
git switch --detach "$BASE"
for s in dev staging prod feature-x; do npx serverless print --stage "$s" > "/tmp/split-check/before-$s.yml"; done
for s in dev prod; do npx serverless package --stage "$s" --package "/tmp/split-check/pkg-before-$s"; done

git switch split-serverless-config-files
for s in dev staging prod feature-x; do npx serverless print --stage "$s" > "/tmp/split-check/after-$s.yml"; done
for s in dev prod; do npx serverless package --stage "$s" --package "/tmp/split-check/pkg-after-$s"; done

for s in dev staging prod feature-x; do diff "/tmp/split-check/before-$s.yml" "/tmp/split-check/after-$s.yml" && echo "print $s identical"; done
for s in dev prod; do
  node --input-type=module -e '
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
const load = (dir) => {
  const t = JSON.parse(readFileSync(`${dir}/cloudformation-template-update-stack.json`, "utf8"));
  for (const [id, r] of Object.entries(t.Resources)) {
    if (r.Type === "AWS::Lambda::Version") delete t.Resources[id];
    if (r.Type === "AWS::Lambda::Function") delete r.Properties.Code;
  }
  delete t.Outputs?.ServerlessDeploymentBucketName;
  for (const key of Object.keys(t.Outputs ?? {})) if (key.endsWith("LambdaFunctionQualifiedArn")) delete t.Outputs[key];
  return t;
};
const [b, a] = process.argv.slice(1).map(load);
console.log(isDeepStrictEqual(b, a) ? "templates equal" : "templates differ");
' "/tmp/split-check/pkg-before-$s" "/tmp/split-check/pkg-after-$s"
done

grep -c "handler:" serverless.yml                 # 0
ls functions resources
git diff "$BASE" --stat -- src tests scripts docs/openapi.yaml   # prints nothing
npm run lint && npm test
```

If `diff` prints anything, the split is wrong: fix the file, do not adjust the expectation. The normalization script is a throwaway check and is not committed (YAGNI); it lives in this spec so the proof is repeatable. If a later spec (0009, 0010) has already merged, `BASE` is the merge commit and the same commands apply, because the split must be neutral at that point too.

The print check compares the resolved configuration; the package check catches differences that only appear when CloudFormation is generated (logical ids, resource order inside a template does not matter to CloudFormation and is ignored by the deep-equal).

## Commit plan

Each commit leaves `serverless print` identical to the base for the four stages above, and lint and tests green (they do not read the config).

1. Add this spec (Draft, then Approved by the maintainer).
2. Move the six functions to `functions/*.yml` and include them from the root file.
3. Move `TaskTable` to `resources/table.yml`.
4. Move the user pool, the app client and the outputs to `resources/auth.yml`.
5. Update the documentation and Spanish references, close this spec.

## Implementation notes

- Verified on the implementation branch with the commands above: `serverless print` was identical (`fc` reported no differences) for dev, staging, prod and `feature-x` after each of the three move commits, and the normalized packaged templates for dev and prod were equal. Lint and the 113 tests passed after every commit.
- The roadmap order change that puts this step first was recorded as an amendment in spec 0000, in its own commit.
- Nothing required a deploy; a deploy of this change should be a CloudFormation no-op, to be confirmed by the maintainer's first deploy (the change set shows no resource changes).

## Risks and rollback

- **Risk:** a moved block changes silently (indent, a dropped key). Mitigated by the byte-identical print for four stages after every commit and by the template comparison.
- **Risk:** the merge of two included `Resources` sections overwrites instead of merging in some Serverless version. Verified with the current CLI on this configuration (two files with different keys merge, `Outputs` included); the print comparison would show any regression after a Serverless upgrade.
- **Risk:** conflicts with the other agents' branches, which edit the same root file (0009, 0010, CORS, SPA client). Mitigated by the recommended order (this first) and by the fact that each later spec edits one small file; if they land first, rebase this spec's moves over them: the moves are mechanical and the print check is the safety net.
- **Risk:** a fork customizes `serverless.yml` and expects functions inside. The README "Configuration for Forks" table is unchanged for the fields that matter (`org`, `service`, `provider.region` stay in the root file) and the new layout is documented.
- **Rollback:** revert the merge. Nothing deployed changes in either direction, so there is no redeploy requirement.

## Decisions to confirm

1. **Order within the runtime chain**: this spec first, then 0009, then 0010, which needs a one-line amendment to the suggested order in spec 0000 (steps 6, 9 and 10 become 10, 6, 9). Evidence: the three specs edit one file; 0009 and 0010 add roughly 150 lines to it and 0010 touches every function; the proof here (print unchanged) is cleanest on the smallest, current config; and splitting first means the later specs and the CORS and SPA client specs add or edit single small files instead of conflicting. Recommended.
2. **One file per function** (six files), not one `functions/tasks.yml`. Recommended.
3. **Two resource files** (`table.yml`, `auth.yml` with the Outputs), and the `provider` block stays in the root file. Recommended; an observability file arrives with 0009.
4. **Proof by `serverless print` byte-identical for dev, staging, prod and an unlisted stage, plus normalized template equality for dev and prod**, with the check script not committed. Recommended; the alternative of adding it as an npm script is deferred to the CI quality gates spec (roadmap step 7) if it is wanted on every pull request.
5. **Directory names `functions/` and `resources/`** at the repository root, as named in the roadmap. Recommended.

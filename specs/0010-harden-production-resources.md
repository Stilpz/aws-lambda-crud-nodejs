# 0010: Harden production resources, stage-aware

- **Status:** Implemented
- **Branch:** `harden-production-resources` (started from `development`)
- **Roadmap step:** 9 of [0000](0000-roadmap-to-layered-architecture.md)
- **Pull request:** to be filled when opened
- **Supersedes / depends on:** builds on [0006](0006-redesign-task-table-keys.md) (the table it protects). Shares the `stages:` parameter block with [0009](0009-add-observability-with-powertools.md); whichever lands first creates the block, the other adds its params. Interacts with the CORS spec (0013) and the SPA app client spec (0015), see Design. Expected implementation order: after 0011 and 0009 (see the order decision in [0009](0009-add-observability-with-powertools.md))

## Context

Every resource in `serverless.yml` is configured for a throwaway stage, and only `dev` is deployed today. Staging and production are planned (roadmap step 8 deploys them), and as written they would be unsafe:

- The `Tasks-<stage>` table and the Cognito user pool have no `DeletionPolicy`, so deleting the stack (`serverless remove`, or a bad rename) deletes all tasks and all users. There is no point-in-time recovery and no deletion protection.
- API Gateway has no route throttling: one client can consume the account-level quota (the default stage in the packaged template has only `DetailedMetricsEnabled: false`).
- All six functions share one role that allows five DynamoDB actions on the table. The `hello` function and the read functions can write and delete; this is the only widening of IAM that AGENTS.md says needs a spec to fix, and it is a least-privilege gap (finding F10).
- The user pool has MFA off and no deletion protection, and the app client allows `USER_PASSWORD_AUTH`, which sends the password from the client code to Cognito (the README already warns about it).

`dev` must stay convenient: stacks there are created and removed often, and `scripts/smoke.sh` creates throwaway users and signs them in with `USER_PASSWORD_AUTH`.

Facts checked while writing this spec:

- Serverless v4 has a native `stages:` block (`default` and per stage `params`), referenced as `${param:name}`, overridable with `--param`. Verified with `serverless print`: `dev` gets the dev values, `staging` and an unknown stage name (`feature-x`) get `default`, and booleans and strings resolve inside `DeletionPolicy`, `DeletionProtectionEnabled`, `PointInTimeRecoverySpecification` and Cognito properties.
- CloudFormation: `DeletionProtectionEnabled` and `PointInTimeRecoverySpecification` on `AWS::DynamoDB::Table` and `DeletionProtection` (`ACTIVE | INACTIVE`) and `MfaConfiguration` (`OFF | ON | OPTIONAL`) on `AWS::Cognito::UserPool` are all "No interruption" updates. `EnabledMfas` accepts `SMS_MFA`, `SOFTWARE_TOKEN_MFA`, `EMAIL_OTP`; software token needs no SMS or email configuration. `UserPoolTier` defaults to `ESSENTIALS`.
- Serverless v4 supports per-function IAM natively: a function with `iam.role.statements` gets its own role (verified in a throwaway `serverless package`: a separate `GetTaskIamRoleLambdaExecution`, with log permission scoped to that function's own log group, X-Ray permission added when tracing is on, and none of the provider-level statements). No plugin is needed; the old `serverless-iam-roles-per-function` plugin is built in.
- Serverless v4 has no native HTTP API throttling setting. The generated stage is the logical resource `HttpApiStage` (`AWS::ApiGatewayV2::Stage`), and `resources.extensions.HttpApiStage` overrides it (verified). The extension replaces `DefaultRouteSettings` as a whole object, so `DetailedMetricsEnabled` must be restated if wanted. CloudFormation supports `ThrottlingBurstLimit` and `ThrottlingRateLimit` there.
- `aws cognito-idp admin-initiate-auth` supports `--auth-flow ADMIN_USER_PASSWORD_AUTH` (checked in the local CLI help); the script already depends on admin APIs and AWS credentials.

## Goal

Make `staging` and any non-`dev` stage safe against accidental loss and abuse (data retained and recoverable, deletion protected, requests throttled, least-privilege roles, MFA available, no client-side password flow), while `dev` keeps its current throwaway behavior and the smoke test keeps working in every stage.

## Scope

1. **Stage profile.** A `stages:` block with `default` params for the strict values and a `dev` override:

   | Param | `default` (staging, prod, any other stage) | `dev` |
   | --- | --- | --- |
   | `deletionPolicy` | `Retain` | `Delete` |
   | `tableProtection` (deletion protection and point-in-time recovery) | `true` | `false` |
   | `userPoolProtection` | `ACTIVE` | `INACTIVE` |
   | `mfa` | `OPTIONAL` | `"OFF"` |
   | `passwordAuthFlow` (`USER_PASSWORD_AUTH` on the app client) | not allowed | allowed |

   Unknown stage names get the strict profile: a mistyped `prodution` must not be unprotected.
2. **Table (`TaskTable`)**: `DeletionPolicy` and `UpdateReplacePolicy` from `deletionPolicy`; `DeletionProtectionEnabled` and `PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled` from `tableProtection`.
3. **User pool (`UserPool`)**: `DeletionPolicy` and `UpdateReplacePolicy` from `deletionPolicy`; `DeletionProtection` from `userPoolProtection`; `MfaConfiguration` from `mfa`, with `EnabledMfas: [SOFTWARE_TOKEN_MFA]` when MFA is not `OFF`.
4. **App client (`UserPoolClient`)**: `ALLOW_USER_PASSWORD_AUTH` only where `passwordAuthFlow` allows it; `ALLOW_USER_SRP_AUTH` and `ALLOW_REFRESH_TOKEN_AUTH` stay everywhere; `ALLOW_ADMIN_USER_PASSWORD_AUTH` is added everywhere, for the smoke test only.
5. **Route throttling**: `resources.extensions.HttpApiStage.Properties.DefaultRouteSettings` with `ThrottlingRateLimit` and `ThrottlingBurstLimit` (per stage params `throttleRate`, `throttleBurst`), restating `DetailedMetricsEnabled: false`.
6. **Per-function IAM**: the provider-level `iam.role.statements` block is removed and each function declares only what it uses on `!GetAtt TaskTable.Arn`:

   | Function | Actions |
   | --- | --- |
   | `hello` | none (shared role: logs only) |
   | `createTask` | `dynamodb:PutItem` |
   | `getTask` | `dynamodb:GetItem` |
   | `getTasks` | `dynamodb:Query` |
   | `updateTask` | `dynamodb:UpdateItem` |
   | `deleteTask` | `dynamodb:DeleteItem` |

   The actions come from the commands `DynamoTaskRepository` sends (`PutCommand`, `GetCommand`, `QueryCommand`, `UpdateCommand`, `DeleteCommand`), one per use case.
7. **Smoke test** (`scripts/smoke.sh`): `get_token` uses `admin-initiate-auth` with `ADMIN_USER_PASSWORD_AUTH` and the user pool id instead of `initiate-auth` with `USER_PASSWORD_AUTH`. Nothing else in the script changes; the tokens are the same ID tokens the JWT authorizer validates.
8. **Documentation**: README (Authentication section and the security note: which flows each stage allows, how to obtain a token in staging and prod, MFA, the retain and recovery runbook, why `serverless remove` fails there), `docs/ARCHITECTURE.md` (F10, roadmap), `docs/openapi.yaml` description if it mentions how to sign in, the Spanish references.

## Out of scope

- CORS, and the browser sign-in app client with the hosted UI, authorization code and PKCE. They are specs 0013 (`add-explicit-cors-origins`) and 0015 (`add-spa-cognito-app-client`). This spec removes the password flow from the existing client outside `dev`; the SPA client is what gives browsers a safe flow. See Design for the interaction.
- Hosted UI domain, callback and logout URLs, identity providers.
- Mandatory MFA (`ON`). It would block the smoke test and every admin-created user; `OPTIONAL` is "an MFA option".
- SMS and email MFA (they need SNS or SES configuration), advanced security (needs the Plus tier), a Cognito tier change.
- Cross-region backups, AWS Backup plans, global tables, export to S3, a custom KMS key.
- Per-route throttling tables, usage plans and API keys (HTTP API has none), AWS WAF.
- Observability, alarms and log retention (spec 0009), the file split (spec 0011).
- Changing the table key or its name (spec 0006). Deploying: the maintainer deploys.

## Design

```
stages:  default --> strict values      dev --> convenient values
              \________ ${param:x} ________/
                     |
   TaskTable / UserPool / UserPoolClient / HttpApiStage / each function's iam
```

- **One switch, many properties.** The values are parameters in one block, and the resources read them. Dev versus strict is visible in one place and reviewed as a table, not scattered conditions. It stays plain Serverless configuration: no plugin, no CloudFormation conditions (Serverless resolves parameters before CloudFormation sees the template, so the template of each stage contains only literal values).
- **Fail safe.** `default` is strict and `dev` is the opt-out. A new stage name, a typo, or a preview stage gets protection. The cost is that a throwaway stage other than `dev` cannot be removed without first turning protection off; the runbook says how, and `dev` is the stage meant for experiments.
- **Retain semantics.** `DeletionPolicy: Retain` keeps the table and the pool when the stack resource is deleted; `UpdateReplacePolicy: Retain` keeps the old one if an update ever forces replacement. Consequence to document: after a deliberate teardown the retained `Tasks-<stage>` table still exists, and redeploying the same stage fails on the name until the table is deleted or imported. That is the intended friction.
- **Recovery.** Point-in-time recovery restores to a new table within the retention window (default 35 days, not configured here, YAGNI). Restore is a manual runbook documented in the README; the app then needs the table name, which a restore-and-swap documents. Cost is a per-GB storage charge, negligible at this size, and the reason `dev` skips it.
- **Throttling.** Stage-wide default route settings are enough for this API: six routes, one client type. The values are per stage (dev lenient, staging and prod modest) and are an abuse and cost guard, not capacity planning. Throttled calls get `429` from API Gateway before any function runs; they appear in the `4xx` metric (HTTP API has no throttle metric), and they are not retried by the API. The OpenAPI contract gains the `429` response in the README notes only if the maintainer wants it documented (see Decisions).
- **Per-function IAM.** Chosen: function-level `iam.role.statements`, no `mode: perFunction`. A function without statements (`hello`, or a future one someone forgets) falls back to the shared role, which after this change carries no table access: forgetting is safe, not permissive. `mode: perFunction` would also work but gives `hello` a role it does not need. A side effect that is wanted: each role's log permission is scoped to its own log group.
- **Auth flows.** Outside `dev` the public client allows SRP (what Cognito SDKs and Amplify use) and refresh. The smoke test moves to the admin flow, which is not callable by an app or a browser (it needs IAM credentials) and which the script already needs for `admin-create-user`; one code path for all stages, instead of detecting the client configuration. `dev` keeps `USER_PASSWORD_AUTH` so the README `aws cognito-idp initiate-auth` examples keep working there. In staging and prod, a developer who needs a token for manual testing uses `admin-initiate-auth` with their credentials, which the README shows.
- **MFA.** `OPTIONAL` with software token (TOTP) means a user can enrol an authenticator app; nothing changes for users who do not. It does not affect the smoke test: its users never enrol. Enrolment UX is the frontend's job (spec 0015's client). TOTP availability on the default Essentials tier should be confirmed (see Risks).
- **Interaction with 0013 and 0015.** 0013 adds `provider.httpApi.cors`; it does not touch anything here, and a throttled 429 produced by API Gateway still carries CORS headers only if API Gateway's CORS is configured at the API level, which it is for HTTP API. 0015 adds a second app client for the SPA with PKCE. That change must also add the new client to the authorizer audience (today it lists only `UserPoolClient`), and must read the same `stages:` params for its callback URLs. Neither reads or reverts the profile table above.
- **Interaction with 0009.** The X-Ray statements that tracing needs are added by Serverless to every role, shared or per function, so removing the provider statements does not remove them. The `stages:` block is shared; this spec adds its own params next to 0009's.
- **Interaction with 0011.** The per-function statements live in each `functions/<name>.yml` after the split; the profile params stay in the root file. Either order works; the split is easier to review first.

Alternatives rejected:

- **CloudFormation parameters and conditions**: more YAML, harder to read, and `DeletionPolicy` cannot take a condition. Serverless-time substitution is simpler.
- **Strict everywhere including dev**: every dev redeploy test would need protection toggled; convenience for the stage meant to be disposable is a stated requirement.
- **A separate serverless file per stage**: duplicates the config and drifts.
- **`mode: perFunction`**: see above.
- **Keeping `USER_PASSWORD_AUTH` in staging for the smoke test**: it would keep the weakness the roadmap item exists to remove.
- **Mandatory MFA**: breaks automation and has no frontend yet.
- **A shared role split by read and write**: three roles with overlapping meaning; one action per function is the clearest least-privilege statement.

Principles: least privilege and fail-safe defaults (security), SRP (the profile owns "how strict", resources own "what"), KISS (one block, literals in the template), YAGNI (no backups plan, no WAF, no custom keys).

## Contract impact

| Area | Impact |
| --- | --- |
| Public API (`docs/openapi.yaml`) | none to routes, schemas or errors; sign-in guidance text may change; throttled calls can return `429` from API Gateway (documented, see Decisions) |
| Client-visible behavior | non-`dev`: `USER_PASSWORD_AUTH` is rejected by Cognito (a client using it must switch to SRP); users may enrol TOTP; sustained bursts above the limit get `429` |
| Infrastructure | table and user pool: policies, deletion protection, PITR, MFA (all in-place updates, no replacement); app client auth flows (in place); `HttpApiStage` default route settings; six roles instead of one shared role with table access. First deploy of a stage rolls these out; dev changes are limited to the roles, the throttling and the extra admin auth flow |
| Data model | none |
| Dependencies | none |
| Documentation | README, `docs/ARCHITECTURE.md`, Spanish references, `scripts/smoke.sh` header comment, this spec |

## Acceptance criteria

- [x] `serverless print --stage dev` and `--stage staging` show the values in the profile table, and `--stage some-other-name` equals the `staging` values for every hardening property.
- [x] `serverless print` for `staging` shows on `TaskTable`: `DeletionPolicy` and `UpdateReplacePolicy` `Retain`, `DeletionProtectionEnabled: true`, `PointInTimeRecoveryEnabled: true`; on `UserPool`: `Retain`, `DeletionProtection: ACTIVE`, `MfaConfiguration: OPTIONAL`, and `EnabledMfas` guarded by a condition that is true; and for `dev` the lenient values (`Delete`, `false`, `INACTIVE`, `OFF`, the condition false so `EnabledMfas` is absent).
- [x] The `UserPoolClient` flows in `staging` are exactly `ALLOW_USER_SRP_AUTH`, `ALLOW_REFRESH_TOKEN_AUTH`, `ALLOW_ADMIN_USER_PASSWORD_AUTH`; in `dev` they also include `ALLOW_USER_PASSWORD_AUTH`.
- [x] `HttpApiStage` has the throttling limits per stage and still has `DetailedMetricsEnabled: false`.
- [x] No provider-level `iam` statements remain. Each of the five task functions has its own role with exactly the one DynamoDB action in the table above on the table ARN, and the shared role has none; `hello` has no DynamoDB access. Verified in `serverless print` (the functions' `iam.role.statements` and the absent provider `iam` block); the generated roles are confirmed by the maintainer with `serverless package`.
- [x] No statement in the resolved configuration allows `dynamodb:*`, a wildcard resource for DynamoDB, or an `/index/*` resource.
- [x] `scripts/smoke.sh` uses `admin-initiate-auth` with `ADMIN_USER_PASSWORD_AUTH`, no longer mentions `USER_PASSWORD_AUTH` in code, and `bash -n scripts/smoke.sh` accepts it.
- [x] No change under `src/` or `tests/` (this spec is infrastructure, script and docs only), and `docs/openapi.yaml` routes and schemas are unchanged.
- [x] README, ARCHITECTURE and the Spanish references describe the profile, the allowed flows per stage, the retain-and-recover runbook and why removal is blocked in strict stages, with matching structure in both languages.
- [x] `npm run lint` and `npm test` pass.
- [ ] After the maintainer deploys (post-deploy, to `dev` first, then `staging` when it exists): `STAGE=dev ./scripts/smoke.sh` and `STAGE=staging ./scripts/smoke.sh` pass; in staging `initiate-auth --auth-flow USER_PASSWORD_AUTH` fails with `NotAuthorizedException` or an unsupported-flow error; `aws dynamodb describe-table` shows deletion protection and `describe-continuous-backups` shows point-in-time recovery enabled; a burst above the limit returns `429`; each function can do its own operation and nothing else (a forced `AccessDenied` is not required).

## Verification

```bash
npm run lint && npm test
bash -n scripts/smoke.sh
grep -n "USER_PASSWORD_AUTH" scripts/smoke.sh      # only ADMIN_USER_PASSWORD_AUTH
git diff <base> --stat -- src tests                # prints nothing
for s in dev staging some-other-name; do npx serverless print --stage $s --format json > /tmp/print-$s.json; done
node -e '
const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const r = c.resources.Resources;
console.log(r.TaskTable.DeletionPolicy, r.TaskTable.Properties.DeletionProtectionEnabled,
  r.UserPool.Properties.MfaConfiguration, r.UserPoolClient.Properties.ExplicitAuthFlows,
  c.resources.extensions.HttpApiStage.Properties.DefaultRouteSettings);
for (const [name, f] of Object.entries(c.functions)) console.log(name, JSON.stringify(f.iam?.role?.statements?.map((s) => s.Action)));
console.log("provider iam:", JSON.stringify(c.provider.iam));
' /tmp/print-staging.json
# maintainer, when able: npx serverless package --stage staging --package /tmp/pkg-staging and read the roles
```

Post-deploy commands are the AWS CLI checks in the last acceptance criterion; they are read-only except the smoke test, which creates and deletes its own throwaway users.

## Commit plan

1. Add this spec (Draft, then Approved by the maintainer).
2. Add the `stages:` profile params (no resource uses them yet; the resolved resources print the same as before for every stage).
3. Protect the table: deletion policy, deletion protection, point-in-time recovery.
4. Protect the user pool: deletion policy, deletion protection, optional MFA.
5. Per-function IAM: move the statements to the functions and drop the provider statements.
6. Throttle routes through the `HttpApiStage` extension.
7. Restrict app client auth flows outside `dev` and add the admin flow, together with the smoke test change (one commit: removing `USER_PASSWORD_AUTH` without the script change would break the smoke test in between).
8. Documentation and Spanish references, close this spec.

## Risks and rollback

- **Risk:** removing `USER_PASSWORD_AUTH` outside `dev` breaks anything that uses it (scripts, Postman collections). Only `dev` is deployed today and the smoke test moves in the same commit. Staging and prod do not exist yet, so no client is affected.
- **Risk:** in `dev` the smoke test and the README examples keep working only because `dev` keeps both flows; if someone deploys `dev` with a typo in the stage name they get the strict profile and a README example fails. Documented.
- **Risk:** a retained table blocks redeploying the same stage name after a teardown. Intended; the runbook documents deleting or importing it.
- **Risk:** deletion protection makes `serverless remove` fail in strict stages. Intended; documented procedure is to turn the params off in a reviewed change first.
- **Risk:** per-function roles omit an action a code path needs, giving a runtime `AccessDenied` as a 500. Mitigated by deriving the actions from the repository and by the smoke test, which exercises create, read, list, update and delete on the deployed stage.
- **Risk:** throttle values set too low reject legitimate bursts. Mitigated by modest defaults and by the fact that they are params, adjustable without a code change.
- **Unverified at spec time:** that `EnabledMfas: [SOFTWARE_TOKEN_MFA]` is accepted on the default Essentials tier without extra configuration (the CloudFormation reference lists it with no SMS or email requirement); the exact `HttpApiStage` throttle behavior on first deploy (checked by `serverless package`, not by deploying); whether `DefaultRouteSettings` with throttling needs `DetailedMetricsEnabled` set explicitly (it is restated to avoid losing it). A failure on first deploy to `dev` shows these early.
- **Rollback:** revert the merge and redeploy. Protection flags, MFA and flows revert in place; retained resources are not deleted by a rollback. A table or pool created with `Retain` stays after a revert and is not lost. The shared role comes back with its five-action statement.

## Amendments

Found while implementing; the Decisions below are unchanged.

1. **Verification uses `serverless print` only** (the implementation environment may not run `package`, which contacts AWS for some lookups). Criteria that read the packaged template now read the resolved configuration; the generated roles are confirmed by the maintainer with `serverless package` or at deploy time.
2. **The app client flows are a per-stage list parameter** (`authFlows`) instead of a yes/no `passwordAuthFlow`, so the exact flows can be read from `serverless print`. The profile meaning is the same.
3. **`EnabledMfas` is guarded by a CloudFormation condition** (`MfaEnabled`, true when the `mfa` parameter is not `OFF`), because Cognito wants `EnabledMfas` removed, not empty, when MFA is `OFF`. A condition with `AWS::NoValue` removes the property; `print` shows the condition, not its result. The CI template validation already keeps `Conditions` (spec 0009).
4. **The `HttpApiStage` extension lives in a new `resources/api.yml`**, included from `serverless.yml`, as the layout from spec 0011 asks for new resource definitions.

## Implementation notes

- Verified with the commands above, using `serverless print` only: dev, staging and an unlisted stage name show the profile values; the unlisted stage equals staging for every resolved resource once the stage name is normalized; no provider `iam` block remains and each task function declares exactly its one DynamoDB action on the table ARN while `hello` declares none; the client flows are exactly the expected lists; `DefaultRouteSettings` carries the per-stage limits and `DetailedMetricsEnabled: false`; no `dynamodb:*` and no `/index/` appear. `npm run lint` clean, `npm test` 139 tests passed (unchanged: no file under `src/` or `tests/` changed in this spec), `bash -n scripts/smoke.sh` accepts the script, `docs/openapi.yaml` is unchanged.
- The generated roles (own role per function, shared role with logging only), the effect of the `HttpApiStage` extension and Cognito's acceptance of `EnabledMfas` behind the condition are confirmed by `serverless package` or the first deploy, which this environment does not run. A throwaway `package` earlier showed that a function-level role does not inherit provider statements and that the stage extension applies.
- A consequence worth knowing: contributors who used a personal stage name now get a protected stage, so the contributor guide points to `dev` and the README "Protected stages" section shows how to remove a protected stage with `--param` overrides. Parameters given with `--param` arrive as strings (`"false"`); CloudFormation accepts them for Boolean properties.
- The post-deploy criterion stays open for the maintainer.

## Decisions to confirm

1. **Strict by default, `dev` as the only lenient stage** (unknown names are strict). Recommended; the alternative (lenient by default, strict list for `staging` and `prod`) risks an unprotected typo.
2. **Smoke test through `ADMIN_USER_PASSWORD_AUTH`** in every stage, and `ALLOW_ADMIN_USER_PASSWORD_AUTH` on the client. Recommended over detecting the client's flows or keeping `USER_PASSWORD_AUTH` in staging.
3. **MFA `OPTIONAL` with TOTP** in non-dev stages, `OFF` in dev; mandatory MFA deferred until the frontend exists. Recommended.
4. **Throttle defaults**: dev 20 requests per second with burst 40, staging and prod 50 with burst 100, as stage params. Recommended as a conservative start, tuned later; also whether to mention the API Gateway `429` in `docs/openapi.yaml` (recommended: yes, as a shared response, in a follow-up if it needs a contract review).
5. **Per-function IAM by function-level statements** (no `mode: perFunction`), one action per function, `hello` on the shared role with no table access. Recommended.

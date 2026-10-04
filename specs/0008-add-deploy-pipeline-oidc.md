# 0008: Add a deploy pipeline with AWS OIDC

- **Status:** Approved
- **Branch:** `add-deploy-pipeline-oidc` (started from `development`)
- **Roadmap step:** 8 of [0000](0000-roadmap-to-layered-architecture.md)
- **Pull request:** to be filled when opened
- **Supersedes / depends on:** depends on [0007](0007-add-ci-quality-gates.md) (the quality gates a deploy must pass first, the `permissions` block and the pinned Serverless version); builds on [0006](0006-redesign-task-table-keys.md) (the stack the smoke test checks)

## Context

Deploys are manual: the README says "Deployments are manual" and the maintainer runs `serverless deploy --stage <stage>` from a laptop with personal AWS credentials. That has three costs:

- **Nothing ties a deployed stage to a reviewed commit.** Which commit runs in `staging` or `prod` is whatever the last person to deploy had checked out.
- **Long-lived AWS credentials live on a workstation**, with far more permission than a deploy needs.
- **The smoke test is optional.** `scripts/smoke.sh` is the only end-to-end proof that authentication and per-user isolation work, and it runs only if someone remembers.

The branch model already maps one to one to stages (`development` to `dev`, `staging` to `staging`, `production` to `prod`, `main` is not deployed), and the table design of 0006 is stage-aware (`Tasks-${sls:stage}`), so the pipeline only has to automate what the README documents.

GitHub Actions can obtain short-lived AWS credentials by presenting its OIDC token to AWS STS (`sts:AssumeRoleWithWebIdentity`) through the `aws-actions/configure-aws-credentials` action, so no AWS access key is ever stored in GitHub.

## Goal

Deploy each long-lived branch to its stage from GitHub Actions, after the quality gates pass, using short-lived AWS credentials from an OIDC role (no stored AWS keys), with a manual approval before `prod`, and run `scripts/smoke.sh` after every deploy.

## Scope

1. **Deploy workflow** `.github/workflows/deploy.yml`, triggered by `push` to `development`, `staging` and `production` (and `workflow_dispatch` to re-run a stage from its branch, see Design). It first calls the CI workflow, then a `deploy` job that needs it. `main` never deploys.
2. **Stage mapping** in one place in the workflow: `development` to `dev`, `staging` to `staging`, `production` to `prod`. The job uses the GitHub Environment of the same name.
3. **Deploy job steps:** checkout, `setup-node` 24 with npm cache, `npm ci`, assume the role with `aws-actions/configure-aws-credentials`, `npx --yes serverless@<pinned> deploy --stage <stage>` authenticated with `SERVERLESS_ACCESS_KEY`, then `STAGE=<stage> REGION=us-west-2 ./scripts/smoke.sh`.
4. **Job-level permissions:** `id-token: write` and `contents: read`, nothing else. No other job gets `id-token`.
5. **Concurrency:** one deploy per stage at a time, never cancelled midway (`concurrency: group: deploy-<stage>`, `cancel-in-progress: false`).
6. **`ci.yml` becomes callable** (`on: workflow_call`) so the deploy workflow reuses it, and its own `push` trigger is limited to `main` so a push to a deploy branch does not run CI twice (see Design).
7. **AWS bootstrap, as code but applied by hand:** a CloudFormation template `infra/github-oidc.yml` that creates the GitHub OIDC identity provider (unless one exists) and one deploy role per stage with a trust policy limited to this repository and the stage's GitHub Environment, and a least-privilege permission policy per role. It is applied once by the maintainer, outside the pipeline (see Design).
8. **GitHub setup documented, not automated:** the three Environments (`dev`, `staging`, `prod`), required reviewers and a branch restriction on `prod`, the environment variable `AWS_ROLE_ARN` per environment, and the `SERVERLESS_ACCESS_KEY` secret.
9. **Smoke script adjustments only if needed** to run non-interactively in CI (it already reads `STAGE`, `REGION`, `STACK`, `API_URL` and exits non-zero on failure). No change is planned; any change is listed in the commit message.
10. **Documentation:** README (deployment, branching and release, "Deployments are manual" replaced), CONTRIBUTING, `docs/ARCHITECTURE.md` (delivery and security notes, roadmap row), AGENTS.md (the rule on deploys and the pipeline), and the Spanish references.

## Out of scope

- Applying the bootstrap template, creating Environments or secrets, or running any deploy. The maintainer does these (AGENTS.md: no deploys or AWS commands without explicit approval).
- Rollback automation, blue/green, canary or `serverless remove` workflows. Rollback is a revert and a redeploy (see Risks).
- Hardening of the application stack (retention, point-in-time recovery, deletion protection, per-function IAM): step 9. This spec only fixes the permissions of the deploy role, not of the Lambda role.
- Multiple AWS accounts per stage. Stages share one account in this spec; separate accounts are a later decision that only changes the role ARNs.
- Preview environments per pull request, and deploys from forks.
- Replacing the Serverless Framework (roadmap step 12 evaluates that).
- Notifications (Slack, email) and deployment dashboards.

## Design

### Triggers and the "CI must pass first" rule

Two ways to guarantee that only green code deploys:

- **Reusable workflow (chosen).** `deploy.yml` runs on `push` and its first job is `uses: ./.github/workflows/ci.yml`; the `deploy` job has `needs: ci`. The check and the deploy are the same workflow run and the same commit. Cost: `ci.yml` needs `on: workflow_call`, and to avoid running CI twice on a push to a deploy branch, `ci.yml` keeps `pull_request` for all four branches and `push` only for `main`.
- **`workflow_run` on CI (rejected).** It runs the workflow definition from the repository's default branch, not from the pushed branch, so `staging` and `production` would deploy using whatever `deploy.yml` is on `development`, and it must be re-checked that the CI run was for the same commit and branch. More moving parts than the problem needs.

Pull requests never deploy: the trigger is `push`, and merging a promotion pull request is what pushes. This matches the existing process (merge commits, no direct commits to the four branches).

`workflow_dispatch` is included with the branch as the ref: running it from `production` redeploys `prod` after approval, which is the rollback path after a revert and the way to retry a failed deploy without a dummy commit. It is not an extra way to deploy arbitrary refs because the stage is derived from `github.ref_name`, and any branch that is not one of the three fails the mapping step.

### Stage mapping and GitHub Environments

One small step computes `stage` from `github.ref_name` with a `case` and fails on anything else; its output feeds `environment: ${{ ... }}` of the deploy job and `--stage`. Three Environments, named exactly as the stages: `dev`, `staging`, `prod`.

- **Manual approval for `prod`.** A GitHub Environment can require reviewers: a job that targets it pauses before it starts, and only the listed reviewers can approve; secrets and variables of the environment are not available until then. `prod` gets required reviewers (the maintainer) and a deployment branch restriction to `production`, so no other branch can deploy to it. `dev` and `staging` have no reviewers (a deploy there is the automatic consequence of a merge) and are restricted to their own branches.
- **Plan and ownership caveats to confirm.** Required reviewers on a private repository need a paid GitHub plan; on a public repository they are free. With a single maintainer, the option "prevent self-review" must stay off or the maintainer could never approve their own promotion. An approval gate that the same person always clicks is a deliberate pause and an audit trail, not a second pair of eyes; the real review is the pull request into `production`.
- Rejected: approval by a manual `workflow_dispatch` only (loses the automatic path and has no environment-scoped secrets); one job per stage duplicated in the file (three near-identical jobs against one parametrized job, since the third use rule is already met).

### AWS authentication with OIDC

`configure-aws-credentials` requests the workflow's OIDC token (hence `id-token: write`) and exchanges it with STS for temporary credentials of the role named by `role-to-assume`. AWS must trust GitHub's issuer, and the trust is decided by the role's trust policy, whose conditions are the real security boundary:

- `aud` must equal `sts.amazonaws.com`.
- `sub` must equal `repo:Stilpz/aws-lambda-crud-nodejs:environment:<env>` for the role of that environment. Using the environment in the `sub` claim, rather than the branch, means the `prod` role can only be assumed by a job that went through the `prod` environment, including its approval and its branch restriction. A job on another branch, a pull request, or a fork cannot present that subject. A condition on the branch only would not enforce the approval.

Each stage has its own role (`github-deploy-dev`, `-staging`, `-prod`), so a compromised `dev` workflow cannot touch `prod`. The role ARN is stored as an environment **variable** (`AWS_ROLE_ARN`), not a secret and never in the repository, because AGENTS.md forbids committing account ids and an ARN contains one. Sessions use the default duration; a deploy plus smoke test is a few minutes, well inside one hour.

### Who creates the OIDC provider and the roles, and least privilege

Chicken and egg: the pipeline cannot create the role it needs to run. So an administrator creates them once, by hand, with credentials that already exist (the maintainer's). To keep it reproducible and reviewable, the definition is a CloudFormation template in the repository, `infra/github-oidc.yml`, deployed manually with `aws cloudformation deploy` and never by the pipeline (the pipeline role must not be able to edit its own permissions). Parameters: repository, the three stage names; the provider is created conditionally so an account that already has one for `token.actions.githubusercontent.com` is not broken (an account can have only one provider per issuer URL).

Rejected: console clicks only (not reviewable, not repeatable); putting the role in `serverless.yml` (it would be created by the deploy that needs it); Terraform or CDK (a new tool for one template, YAGNI).

Least privilege for a Serverless Framework v4 deploy on this stack. What the deploy actually does: it creates or updates a CloudFormation stack `aws-lambda-crud-nodejs-<stage>`, uploads the package to an S3 deployment bucket the framework creates (`serverless-framework-deployments-...`, or a bucket named in the stack), and CloudFormation creates the resources declared in `serverless.yml`: Lambda functions, an IAM execution role, an HTTP API with a JWT authorizer, a CloudWatch log group per function, a DynamoDB table `Tasks-<stage>`, a Cognito user pool and client. The role is scoped by resource naming wherever IAM allows it:

| Area | Permission, scoped to |
| --- | --- |
| CloudFormation | create, update, describe and delete stack actions on `stack/aws-lambda-crud-nodejs-<stage>/*`; `ValidateTemplate`, `GetTemplateSummary` and list actions on `*` |
| S3 | the framework's deployment bucket only: bucket creation and configuration for the `serverless-framework-deployments-*` pattern, object read/write/delete inside it |
| Lambda | function lifecycle, versions, event source and permission actions on `function:aws-lambda-crud-nodejs-<stage>-*` |
| IAM | create/update/delete role, role policy and `PassRole` on `role/aws-lambda-crud-nodejs-<stage>-*`, with `iam:PassRole` conditioned to `lambda.amazonaws.com`; no permission to create users, access keys, OIDC providers or to touch other roles |
| API Gateway | `apigateway` actions on the HTTP API resources of the region (API Gateway resource ARNs have no readable names, so this scope is the region and the `/apis*` path) |
| DynamoDB | table lifecycle on `table/Tasks-<stage>` |
| Cognito | user pool and client lifecycle on `userpool/*` in the account and region (pool ids are generated, so name scoping is not possible) |
| CloudWatch Logs | log group lifecycle on `log-group:/aws/lambda/aws-lambda-crud-nodejs-<stage>-*` |
| Smoke test | see below |

Two honest limits: Serverless/CloudFormation permissions cannot be scoped to nothing broader than `*` for some read and list actions and for API Gateway and Cognito create calls, and a role that can create IAM roles can in principle escalate; this is bounded by the name prefix on the resources it may manage and by the fact that only a reviewed commit on one branch can assume it. An IAM permissions boundary on the created Lambda roles is a stronger control and is left to step 9. The exact action lists are written when the template is drafted, derived from a run with CloudTrail access analysis or by iterating on `dev`, not guessed here; the spec requires that the final policy contain no `*:*` and no `Resource: "*"` on a write action where a name scope is possible.

### The Serverless Framework needs its own authentication

Independent of AWS, Serverless Framework v4 requires authentication, and `serverless.yml` pins `org: stivencardona`. In CI that means a `SERVERLESS_ACCESS_KEY` environment variable created in the Serverless dashboard (per the framework's own guidance for CI and as the README troubleshooting table already says). OIDC removes the AWS keys; it does not remove this key. It is stored as an Environment **secret** (one per environment, so `prod`'s is only released after approval; the same key value may be reused across them if the dashboard issues one per org, which is acceptable). It grants framework access for the org, not AWS access. Rejected: logging in interactively (impossible in CI); the framework's own dashboard-managed AWS provider integration (it would move the AWS trust to Serverless Inc. and replace the OIDC role this step is about). The framework version is pinned in the workflow (`SERVERLESS_VERSION`, the same value as the 0007 template job; registry latest at the time of writing is 4.43.0) and run through `npx --yes serverless@$SERVERLESS_VERSION`, so a new release cannot change a deploy unreviewed. Whether Serverless's licensing terms require a paid plan for this organization is not verified here and is on the maintainer to confirm in the dashboard.

### Smoke test after each deploy

`scripts/smoke.sh` runs on the runner right after the deploy, under the same role session. Facts from the script: it reads the stack outputs `UserPoolId` and `UserPoolClientId` with `cloudformation:DescribeStacks`, finds the API with `apigatewayv2:GetApis`, creates two throwaway users (`cognito-idp:AdminCreateUser`, `AdminSetUserPassword`), signs in with the `USER_PASSWORD_AUTH` flow (`InitiateAuth` is a public Cognito call with no IAM permission; the app client already enables `ALLOW_USER_PASSWORD_AUTH` in `serverless.yml` for every stage), calls the API with curl, and deletes users and the task in a `trap` (`AdminDeleteUser`). The deploy role therefore also needs, for the smoke test only: `cloudformation:DescribeStacks` (already in the deploy set), `apigateway:GET` on `/apis` (covered by the API Gateway statement), and `cognito-idp:AdminCreateUser`, `AdminSetUserPassword`, `AdminDeleteUser` on `userpool/*`. It does not need DynamoDB access: the smoke test goes through the API.

Consequences to make explicit:

- The smoke test creates and deletes real, if short-lived, users in the `prod` user pool, and the deploy role gets Cognito admin write permission on pools in the account. It is the same permission set the script already needs when the maintainer runs it by hand. The alternative, a dedicated role assumed only for the smoke step, is stricter but adds a second role per stage; rejected for now (KISS) and listed as a decision.
- The smoke test is a **verification, not a gate that undoes the deploy**: when it fails, the workflow run fails and shows red, but the new version is already live. There is no automatic rollback (see Risks). For `prod` this is acceptable because the same commit already passed `dev` and `staging`.
- `scripts/smoke.sh` needs `curl`, `node` and the AWS CLI, all present on the GitHub-hosted `ubuntu-latest` runner, and Node 24 comes from `setup-node`. The AWS CLI on the runner reads the credentials exported by `configure-aws-credentials`.

### Concurrency and ordering

Merges to `development`, `staging` and `production` can occur close together. Per-stage `concurrency` groups serialize deploys of the same stage (two simultaneous `serverless deploy` runs against one stack fail in CloudFormation) and do not cancel an in-flight deploy, because cancelling a deploy mid-update can leave the stack in an update rollback state. Different stages deploy in parallel.

### First-run consequences

Spec 0006 already replaced the table and deletes the old `TaskTable-<stage>` on deploy. The first pipeline deploy of each stage will apply every change merged since the last manual deploy, including that table replacement, whose data loss was accepted for `dev`. Before enabling the pipeline for `staging` or `prod`, the maintainer must confirm no stage holds data that matters, or perform a manual deploy first. This is called out in Risks and in the rollout order below.

### Principles applied

- **KISS and YAGNI:** one workflow, one parametrized job, one role per stage, one CloudFormation file applied by hand; no Terraform, no reusable composite actions, no rollback tooling, no notifications.
- **Single responsibility:** the pipeline deploys and verifies; creating the trust and the roles is a separate, manual, reviewed act that the pipeline cannot perform on itself.
- **Least privilege and separation:** per-stage roles, trust bound to the GitHub Environment, name-scoped statements, job-level `id-token` only on the deploy job.
- **Clean Code:** the stage mapping appears once; the smoke test is the existing script, not a second implementation of the same checks in YAML.

### Rollout order (documented in the README, performed by the maintainer)

1. Merge this spec's implementation. Nothing deploys yet, because the roles and Environments do not exist; the `deploy` job would fail at the credentials step (the failure is expected until step 4 and is stated in the pull request).
2. Apply `infra/github-oidc.yml` with the maintainer's own credentials, `dev` role first.
3. Create the Environments, variables and secrets, `dev` first, `prod` with reviewers.
4. Merge or re-run on `development` and watch the `dev` deploy and smoke test; then promote to `staging`, then `production`.

## Contract impact

| Area | Impact |
| --- | --- |
| Public API (`docs/openapi.yaml`) | none |
| Infrastructure (`serverless.yml`) | none; no change to the application stack |
| AWS account | new, applied by hand: GitHub OIDC provider, three deploy roles with policies (`infra/github-oidc.yml`) |
| GitHub settings | three Environments (`dev`, `staging`, `prod`), `AWS_ROLE_ARN` variable and `SERVERLESS_ACCESS_KEY` secret per environment, reviewers and branch restriction on `prod` |
| CI | `ci.yml` becomes a callable workflow; new `deploy.yml` |
| Data model | none |
| Documentation | README (deployment, release workflow, troubleshooting), CONTRIBUTING, `docs/ARCHITECTURE.md`, AGENTS.md, Spanish references |

## Acceptance criteria

- [ ] `.github/workflows/deploy.yml` triggers on `push` to `development`, `staging`, `production` and `workflow_dispatch`, never on pull requests or on `main`, and fails for any other ref.
- [ ] The deploy job `needs` the CI workflow, and a failing CI run (lint, tests, coverage, audit, template, integration) prevents the deploy job from starting.
- [ ] The stage is derived from the branch in exactly one place: `development` to `dev`, `staging` to `staging`, `production` to `prod`; the job's `environment` and `--stage` use that value.
- [ ] The deploy job declares `permissions: id-token: write, contents: read`; no workflow job has `id-token: write` unless it assumes a role; no AWS access key or secret key appears anywhere in the repository or the workflow.
- [ ] Credentials come from `aws-actions/configure-aws-credentials` with `role-to-assume` read from the `AWS_ROLE_ARN` environment variable.
- [ ] `infra/github-oidc.yml` passes `cfn-lint` and creates, per stage, a role whose trust policy requires `aud = sts.amazonaws.com` and `sub = repo:Stilpz/aws-lambda-crud-nodejs:environment:<stage>`, and whose permission policy contains no `Action: "*"`, no `iam:CreateUser` or access key actions, and name-scoped resources for every write action where the service allows it.
- [ ] The `prod` environment requires a reviewer and is restricted to the `production` branch (confirmed in the repository settings by the maintainer; the setting is recorded in the pull request).
- [ ] The Serverless Framework version is pinned in one workflow value and authenticated with `SERVERLESS_ACCESS_KEY` from the environment secrets.
- [ ] `STAGE=<stage> REGION=us-west-2 ./scripts/smoke.sh` runs after `serverless deploy` in the same job, a smoke failure fails the run, and `bash -n scripts/smoke.sh` still passes.
- [ ] Deploys of one stage never run concurrently and are not cancelled mid-run.
- [ ] After the maintainer completes the rollout: a merge to `development` deploys `dev` and the smoke test passes; a merge to `production` waits for approval, then deploys `prod` and the smoke test passes; the workflow logs show an assumed-role session and no stored keys.
- [ ] The README no longer says deployments are manual and documents the bootstrap, the Environments, the secrets and the rollback path, with matching structure in both languages.
- [ ] `npm run lint` and `npm test` pass.

## Verification

```bash
npm run lint && npm test
bash -n scripts/smoke.sh
grep -rniE "AKIA|aws_secret_access_key|aws_access_key_id" .github infra README.md   # prints nothing
grep -n "id-token" .github/workflows/*.yml                                          # only in the deploy job
pip install cfn-lint && cfn-lint infra/github-oidc.yml
actionlint .github/workflows/deploy.yml .github/workflows/ci.yml                   # if the maintainer has it; otherwise review by eye
git diff development --stat -- src serverless.yml docs/openapi.yaml                # prints nothing
```

Through the maintainer, after the bootstrap: push to `development` and watch the run: CI jobs, then `deploy` under the `dev` environment, then the smoke output ending in `All checks passed`. Check the CloudTrail event `AssumeRoleWithWebIdentity` for the session, and `aws iam list-open-id-connect-providers` shows the GitHub provider. Prove the trust boundary: re-run the workflow from a branch that is not allowed (it fails at the stage mapping), and confirm in the `prod` run that the job waits for approval before any secret is available.

## Commit plan

1. Add this spec (Draft, then Approved by the maintainer).
2. Make the CI workflow callable and limit its own push trigger to `main`.
3. Add the OIDC provider and deploy roles template, `infra/github-oidc.yml`.
4. Add the deploy workflow: stage mapping, OIDC credentials, pinned Serverless deploy, smoke test, concurrency.
5. Document the pipeline, the manual bootstrap and rollout, and the branch-to-stage rule (README, CONTRIBUTING, ARCHITECTURE, AGENTS.md, Spanish references) and close this spec.

Each commit leaves `npm run lint` and `npm test` green.

## Risks and rollback

- **Risk:** a mistake in the trust policy lets the wrong workflow assume a role. Mitigation: `sub` is pinned to the repository and an Environment, `aud` is fixed, per-stage roles, `prod` also behind reviewers and a branch restriction; reviewed in the spec's acceptance criteria and in the pull request.
- **Risk:** the deploy role is over-permissive because Serverless needs broad actions. Mitigation: name-scoped statements, no ability to alter the OIDC provider or the deploy roles, and a permissions boundary deferred to step 9; the policy is derived from real deploys on `dev`, not guessed.
- **Risk:** a bad merge reaches `dev` or `staging` automatically. That is intended; promotion to `prod` still needs a pull request and an approval.
- **Risk:** the first deploy of a stage applies the 0006 table replacement and drops old data. Mitigation: rollout order, explicit confirmation that no stage holds data that matters.
- **Risk:** a failed smoke test leaves a bad version live. Mitigation: the run is red and the maintainer reverts and redeploys; the commit already ran in the lower stages. An automatic rollback is not built (YAGNI) and would be its own spec.
- **Risk:** a failed deploy leaves a CloudFormation stack in `UPDATE_ROLLBACK_FAILED` or a smoke test aborted before cleanup leaves a throwaway user. Mitigation: concurrency without cancellation; the script's `trap` cleans up on failure, and stray users have the prefix `smoke-` in the user pool.
- **Risk:** the Serverless access key or Serverless licensing blocks CI. Mitigation: verified by the first `dev` run before `prod` is enabled; the key is rotated from the dashboard.
- **Risk:** the GitHub plan does not offer required reviewers for the repository's visibility. Mitigation: confirmed before the rollout; the fallback is a protected `production` branch plus manual `workflow_dispatch` only for `prod`.
- **Rollback of this change:** revert the merge (the pipeline disappears and manual deploys work as before), then remove the three roles and the provider with `aws cloudformation delete-stack` for the bootstrap stack, done by the maintainer. Rollback of a **bad deploy**: revert the offending merge on the branch and let the pipeline redeploy, or use `workflow_dispatch` from that branch; a stack update that CloudFormation rolled back needs no action.

## Amendments

1. **The bootstrap template is applied once per stage, not once for all stages.** Scope item 7 and the bootstrap section describe one template that creates the provider and the three roles in a single application. The implemented `infra/github-oidc.yml` takes a `Stage` parameter and creates that stage's role, plus a `CreateOidcProvider` parameter that is `true` in exactly one of the three stacks. Reasons: three roles in one stack would put the `prod` role in the same change set as `dev` and delete all three together, and a stack per stage lets the administrator create `dev` first and `prod` last, as the rollout order asks, without a template macro. The trust, the permissions and the rollout order are unchanged; the administrator runs the same template three times. Found while writing the template.

## Decisions to confirm

1. **Gate on CI through a reusable workflow** (`ci.yml` gets `workflow_call`, its `push` trigger shrinks to `main`). *Recommended.* Alternative: `workflow_run`, rejected above.
2. **Roles and trust:** one role per stage, `sub` bound to the GitHub Environment, role ARN in an environment variable. *Recommended.* Alternative: one role for all stages bound to branches (simpler, weaker for `prod`).
3. **Bootstrap through `infra/github-oidc.yml`**, committed in this change and applied by hand with `aws cloudformation deploy`. *Recommended.* Alternative: a documented console procedure only.
4. **Run the smoke test on `prod`** under the same role, accepting Cognito admin write permissions on the pool and throwaway users in prod. *Recommended, as the roadmap asks for it after each deploy.* Alternative: a separate smoke role, or skip `prod`.
5. **Approval policy for `prod`:** required reviewer is the maintainer, self-review allowed, deployment branch restricted to `production`; and the `SERVERLESS_ACCESS_KEY` stored as an environment secret. *Recommended.* Needs the maintainer to confirm the repository's GitHub plan supports required reviewers.

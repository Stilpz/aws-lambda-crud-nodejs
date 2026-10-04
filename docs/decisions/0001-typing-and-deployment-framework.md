# 0001: Typing and deployment framework

- **Date:** 2026-10-03
- **Governing spec:** [0016](../../specs/0016-evaluate-typescript-migration.md), roadmap step 12 of [0000](../../specs/0000-roadmap-to-layered-architecture.md)

## Status

Accepted. The maintainer approved spec 0016, including the outcomes recorded under Decision.

## Context

Two questions were open in `docs/ARCHITECTURE.md` ("Open decisions") and in roadmap step 12:

1. **Language.** The code is plain JavaScript (ES modules, Node 24) with no build step: `serverless.yml` points straight at `src/handlers/*.js`. It has about 490 lines under `src/`, is layered (`handlers -> application -> domain`, spec 0003) and has JSDoc only in the domain (`src/domain/task.js`, the `TaskRepository` port in `src/domain/taskRepository.js`) plus one `@implements` tag in `DynamoTaskRepository`. Nothing checks these annotations.
2. **Deployment framework.** The stack is deployed with Serverless Framework v4 (`frameworkVersion: "4"`, `org: stivencardona`). The README ("Prerequisites", "Troubleshooting") already records that v4 needs a Serverless account (`serverless login` or `SERVERLESS_ACCESS_KEY`), so a fork without an account cannot deploy as is. Roadmap step 8 will deploy from GitHub Actions through an AWS OIDC role, and anything the deploy tool needs besides that role becomes a pipeline secret.

A React frontend will consume a client generated from `docs/openapi.yaml` (spec 0014), so the API's own language is independent of the client's types.

## Decision drivers

Weights are fixed here, before scoring: high = 3, medium = 2, low = 1. Scores: Good = 2, Fair = 1, Poor = 0. Weighted score = weight times score.

**Part A, typing**

| Criterion | Weight |
| --- | --- |
| Adoption cost in this repository (files touched, errors to fix) | high |
| Impact on build, packaging, handler paths and tests | high |
| Defects the option can catch | medium |
| New dependencies and tooling (`AGENTS.md`: no dependency without a spec) | medium |
| Fit with the generated client of spec 0014 | medium |
| Reversibility | low |

**Part B, deployment framework**

| Criterion | Weight |
| --- | --- |
| Migration cost and risk to deployed stages | high |
| Fork-friendliness (a contributor deploys with documented steps and no paid or personal account) | medium |
| Licensing and cost for this use | medium |
| Fit with the OIDC pipeline of spec 0008, including long-lived secrets | medium |
| Local development and testing | medium |
| Maintenance burden and vendor risk | medium |
| Effect on the layered architecture, specs and tests | low |
| Effect on the frontend track (typed client, per-stage URLs) | low |

Ties are broken by the project's own rule (KISS and YAGNI, `AGENTS.md`): the option that changes least wins.

## Verified facts

All checked on 2026-10-03.

| Claim | Source | Checked on |
| --- | --- | --- |
| Serverless CLI v4 is free for organizations under USD 2 million annual revenue, on an honor system with no proof required; above that a paid subscription is required; pay-as-you-go is USD 4 per credit, reserved credits cost less with annual contracts | https://www.serverless.com/pricing and https://www.serverless.com/framework/docs/guides/upgrading-v4 | 2026-10-03 |
| v4 requires authentication, through the Dashboard (email, Google or GitHub) or a License Key set as an environment variable or stored in the SSM parameter `/serverless-framework/license-key` | the same pages | 2026-10-03 |
| `org` and `app` are optional in `serverless.yml`; a default org is written to `.serverlessrc` | https://www.serverless.com/framework/docs/providers/aws/guide/serverless.yml | 2026-10-03 |
| Serverless v4 builds TypeScript handlers with esbuild without a plugin and bundles by default (`build.esbuild`); it does not type-check and the docs say to keep `tsc --noEmit` in CI | https://www.serverless.com/framework/docs/providers/aws/guide/building | 2026-10-03 |
| SAM builds Node.js and TypeScript functions with esbuild through `Metadata: BuildMethod: esbuild`; its page does not mention type checking | https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-using-build-typescript.html | 2026-10-03 |
| Lambda `nodejs24.x`: deprecation 2028-04-30, block create 2028-06-01, block update 2028-07-01; `nodejs22.x`: 2027-04-30 | https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html | 2026-10-03 |
| npm: `typescript` 7.0.2, `serverless` 4.43.0, `aws-cdk` 2.1144.0 with license Apache-2.0, `openapi-typescript` 7.13.0 with peer dependency `typescript ^5.x`, `@types/node` 26.6.4 | `npm view <package>` | 2026-10-03 |
| Repository facts: `package.json` has no build script; `serverless.yml` has about 130 lines, handler paths `src/handlers/<file>.<export>`, a single `hello` public route and five authorized routes; `scripts/smoke.sh` resolves the API by the name `<stage>-<service>` and reads the stack outputs `UserPoolId` and `UserPoolClientId`; CI has one job running `npm ci`, `npm run lint`, `npm test` | the files at commit 22b9b61 | 2026-10-03 |

**Unverified** (not confirmed from a primary source during this evaluation): the license of the `serverless` npm package (its `license` field is empty; the terms above come from the pricing page); the license of the SAM CLI; that SAM accepts `nodejs24.x` (the SAM page example uses `nodejs20.x`); the CDK `NodejsFunction` bundling behavior; whether Serverless v4 offers any CI authentication other than a Dashboard access key or a License Key (the name of the secret was not confirmed in the docs read); what Serverless v4 includes by default in a function package for plain JavaScript handlers.

## Trial evidence (typing)

Run once, outside the repository, on a clean `npm ci` of this commit, with `tsc --noEmit --allowJs --checkJs --module nodenext --moduleResolution nodenext --target es2023 --skipLibCheck --types node`. Nothing was added to the repository.

| Target | TypeScript 5.9.3, default flags | TypeScript 5.9.3, `--strict` | TypeScript 7.0.2, default flags |
| --- | --- | --- | --- |
| `src/` | 4 errors | 60 errors (30 `TS7006` and 25 `TS7031`, implicit `any` on parameters and destructured parameters) | 60 errors |
| `tests/` | 6 errors | 190 errors (87 `TS7005`, 56 `TS7006`, 27 `TS7031`, 12 `TS7034`) | 190 errors |

Observations:

- TypeScript 7.0.2 reported with default flags exactly what 5.9.3 reports with `--strict`, so under 7 `strict` behaves as the default. Adopting the checker with a major later than 5 means starting with strict mode or opting out explicitly.
- The 4 errors in `src/` that do not depend on strictness are real findings to fix at adoption: `src/infrastructure/dynamoTaskRepository.js` line 41 (`@implements {import("...")}` is not parsed, `TS1005` and `TS2304`), `src/handlers/middleware.js` line 9 (`new Ajv(...)` is reported as not constructable, a default-import interoperability issue under `nodenext`, `TS2351`) and `src/handlers/errorBoundary.js` line 24 (`instanceof` against an entry of `STATUS_BY_ERROR`, `TS2359`).
- The remaining strict errors in `src/` are almost all missing parameter annotations; the use cases and the repository are the places where annotations carry information (`TaskRepository` already documents them). In `tests/` the cost is higher because of untyped test doubles and `mockDynamo` helpers.
- `openapi-typescript` accepts only `typescript ^5.x` as a peer today, so the checker's major is constrained by spec 0014 until that changes.

## Options

### Part A: typing

- **A1.** Stay as is.
- **A2.** Keep JavaScript, enforce the existing JSDoc types with `tsc --noEmit` (`allowJs`, `checkJs`, no emit) in CI.
- **A3.** Migrate to TypeScript with an esbuild build.

| Criterion (weight) | A1 | A2 | A3 |
| --- | --- | --- | --- |
| Adoption cost (3) | Good: nothing to do | Good: 4 non-strict errors in `src/`; parameter annotations for strict, applied file by file | Poor: every file in `src/` and `tests/` is renamed and typed, and the import and test helper conventions change |
| Build, packaging, handlers, tests (3) | Good: unchanged | Good: no emit, `serverless.yml` handler paths, packaging, Vitest and the smoke test unchanged | Poor: a build output, handler paths and source maps for readable logs, ESM `.ts` import conventions, a typed ESLint setup |
| Defects caught (2) | Poor: JSDoc types are decoration | Fair: catches shape and null mistakes where annotated; coverage grows as annotations are added | Good: enforced everywhere |
| Dependencies and tooling (2) | Good: none | Fair: `typescript` and `@types/node` as devDependencies, justified in a spec | Fair: the same plus a build step if the framework does not provide one |
| Fit with the typed client of spec 0014 (2) | Fair: generated `.d.ts` types cannot be checked against the code | Good: the generated types are consumed through JSDoc `import()` and verified | Good: direct imports |
| Reversibility (1) | Good | Good: delete one script and one config file | Poor: a rename across the tree and a build removal |
| **Weighted total** | 6 + 6 + 0 + 4 + 2 + 2 = **20** | 6 + 6 + 2 + 2 + 4 + 2 = **22** | 0 + 0 + 4 + 2 + 4 + 0 = **10** |

**Concrete repository changes per option**

| Area | A1 | A2 | A3 |
| --- | --- | --- | --- |
| `serverless.yml` handlers | none | none | paths unchanged in text; Serverless builds `.ts` handlers with esbuild per its docs, output and source maps to be checked |
| Packaging | classic zip | unchanged | esbuild bundle, `external` choices for the AWS SDK |
| Sources and tests | none | none | `.ts` files, import-extension policy, renamed tests and helpers |
| ESLint 10 flat config | none | none | typed linting needs a TypeScript parser dependency |
| Dependencies | none | `typescript`, `@types/node`, possibly `@types/aws-lambda` | the same plus a build tool if the framework does not supply one |
| CI | none | one step `npm run typecheck` | typecheck plus build |
| `scripts/smoke.sh` | none | none | none (black box over HTTP) |

### Part B: deployment framework

- **B1.** Stay on Serverless Framework v4.
- **B2.** AWS SAM.
- **B3.** AWS CDK.

| Criterion (weight) | B1 | B2 | B3 |
| --- | --- | --- | --- |
| Migration cost and risk (3) | Good: none | Fair: a new `template.yaml`, a changed smoke test, new commands in README and CONTRIBUTING; functions and the HTTP API get new logical ids, so the API id and base URL change (the explicitly named table and user pool keep theirs) | Poor: declarative config rewritten as code, a bootstrap stack, the same API replacement |
| Fork-friendliness (2) | Fair: needs an account or a license key; `org` is optional per the docs | Good: AWS credentials only | Fair: AWS credentials, plus a one-time bootstrap in the account |
| Licensing and cost (2) | Good for this use: free under USD 2 million revenue, honor system | Good: no account or fee (the SAM CLI license itself is unverified) | Good: Apache-2.0 for `aws-cdk` |
| OIDC pipeline fit (2) | Fair: OIDC role plus a Serverless access or license key, a long-lived secret beside the role | Good: the OIDC role is the whole credential story | Fair: OIDC role plus bootstrap roles that `cdk deploy` assumes |
| Local development (2) | Good: `serverless dev` and `invoke local`, already in the README | Fair: `sam local` needs Docker, and the README section is rewritten | Fair: `cdk synth`, local invoke through the SAM CLI |
| Maintenance and vendor risk (2) | Fair: terms and account requirements are controlled by one vendor and have changed between v3 and v4 | Good: a thin layer over CloudFormation maintained by AWS | Fair: a larger surface, a new language of infrastructure |
| Layering, specs, tests (1) | Good | Good | Fair: infrastructure becomes code that needs its own tests and lint |
| Frontend track (1) | Good | Good | Good |
| **Weighted total** | 6 + 4 + 4 + 2 + 4 + 2 + 2 + 2 = **26** | 3 + 4 + 4 + 4 + 2 + 4 + 2 + 2 = **25** | 0 + 2 + 4 + 2 + 2 + 2 + 1 + 2 = **15** |

**Concrete repository changes per option**

| Area | B1 Serverless v4 | B2 SAM | B3 CDK |
| --- | --- | --- | --- |
| Infrastructure file | `serverless.yml`, `resources` is plain CloudFormation | `template.yaml`; functions become `AWS::Serverless::Function` with `HttpApi` events and the JWT authorizer under `Auth`; the `resources` block moves over unchanged | an app that synthesizes the template; the table, pool and client become constructs |
| Handler paths | `handler: src/handlers/x.fn` | `CodeUri` and `Handler: x.fn`; the layout under `src/handlers/` needs a decision or esbuild entry points | `NodejsFunction` takes an entry file |
| Packaging | built in; no `package:` block today | `sam build`; esbuild through `Metadata` | `NodejsFunction` bundles with esbuild |
| Stack and ids | stack `<service>-<stage>`, generated logical ids | the stack name is free and can stay the same; logical ids of functions and the API differ | new logical ids unless overridden |
| Smoke test | finds the API by name `<stage>-<service>` | the name differs: an `ApiUrl` stack output replaces the lookup | same |
| Pipeline (spec 0008) | OIDC role plus a Serverless key secret | OIDC role only: `sam build`, `sam deploy` | OIDC role plus bootstrap roles |
| Config split (spec 0010) | `functions/` and `resources/` files | not applicable | not applicable |
| Fork experience | account or key | AWS credentials | bootstrap, then deploy |

**Sensitivity.** The totals of part B are close (26 against 25). Raising only fork-friendliness to high gives 27 for B1 and 27 for B2; raising only the OIDC criterion to high gives the same tie; raising both gives 28 for B1 and 29 for B2. Scores are judgments made from the repository and the sources above; the record does not claim precision.

## Decision

- **Typing: A2.** Keep JavaScript and enforce the JSDoc types with `tsc --noEmit --checkJs`, adopted incrementally. A2 scores highest (22 against 20 and 10): it adds a single check without touching handler paths, packaging, Vitest or the smoke test, and it fits the typed client. A3 is rejected for now because its cost (a build stage and a renamed tree) buys nothing the check does not already give on 490 lines.
- **Framework: B1.** Stay on Serverless Framework v4, with SAM as the documented fallback. The scores are a near tie, so the rule "the option that changes least wins" decides: a migration would replace the Lambda functions and the HTTP API (a new base URL for the frontend) for no functional gain, while B1 is free for this use and its `resources` block is plain CloudFormation that moves unchanged to SAM if needed.

## Consequences

- **Typing.** A follow-up spec `add-jsdoc-type-checking` (proposed, not in the roadmap yet) adds the `typescript` and `@types/node` devDependencies, a `typecheck` script and one CI step. It must fix the three non-strict findings above, choose a `strict` policy knowing TypeScript 7 defaults to strict, and pin the TypeScript major to what `openapi-typescript` accepts.
- **Spec 0014** consumes the generated types through JSDoc `import()` on the API side; the React side is TypeScript by necessity and is decided in spec 0018.
- **Spec 0008** must provision a Serverless authentication secret (access key or License Key) in the GitHub environments next to the OIDC role. Whether that can be avoided is unverified. This is the main cost of staying on B1 and the first thing to re-check.
- **Spec 0010** (split config files) stays valid because the framework stays.
- **Forks** keep needing a Serverless login or key; the README guidance already says so and stays as is. A fork program that needs one-command deploys is a revisit trigger.
- **Documentation.** `docs/ARCHITECTURE.md` resolves the framework item of "Open decisions" and closes roadmap row 12; spec 0000 links this record on row 12.

## Revisit triggers

Reopen part B when any of these is observed:

- The owner's organization exceeds the revenue threshold of the Serverless license, or the terms on the pricing page change.
- A fork or contributor program needs one-command deploys without an account, or a contributor cannot deploy because of the account requirement.
- The pipeline of spec 0008 cannot authenticate Serverless without a long-lived secret that the maintainer is not willing to hold.
- A second service is added to the repository, making a shared tool or CDK constructs worthwhile.

Reopen part A when any of these is observed:

- Defects that a type check would have caught reach `staging` or `production`.
- The checker produces more suppressions than annotations.
- Spec 0014 changes the client tooling so that JSDoc consumption no longer works.

## Migration sketches for the runner-up

**To SAM (B2).** 1. Add `template.yaml` with `Transform: AWS::Serverless-2016-10-31`; copy the `resources` block (`TaskTable`, `UserPool`, `UserPoolClient`, outputs) unchanged. 2. Declare the five task functions and `hello` as `AWS::Serverless::Function` with `Runtime: nodejs24.x` (to be verified with SAM), `Architectures: [arm64]`, an `HttpApi` event per route and the JWT authorizer under the HTTP API `Auth` with the same issuer and audience. 3. Move the environment variable `TABLE_NAME` and the DynamoDB policy statements to function properties. 4. Add an `ApiUrl` output and change `scripts/smoke.sh` to read it. 5. Choose the stack name (the current one can be reused) and a per-stage `samconfig.toml`; accept that the HTTP API id changes. 6. Replace `serverless` commands in README, CONTRIBUTING and the pipeline with `sam build` and `sam deploy`; retire the `org` guidance and spec 0010. Not carried over: `serverless dev` and `invoke local`.

**To TypeScript (A3).** 1. Add `typescript`, the typecheck script and the A2 check first (it is the prerequisite). 2. Rename `src/` and `tests/` files module by module, domain first, with the type check passing after each. 3. Let Serverless build the handlers with esbuild (`build.esbuild`) and verify the package contents and source maps. 4. Add a typed ESLint configuration. 5. Keep the handler paths in `serverless.yml` unless the build output changes them.

## Documents that depend on this record

- `docs/ARCHITECTURE.md`: "Open decisions" and roadmap row 12.
- `specs/0000-roadmap-to-layered-architecture.md`: row 12 links this record.

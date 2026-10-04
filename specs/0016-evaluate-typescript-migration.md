# 0016: Evaluate a TypeScript migration and the deployment framework

- **Status:** Approved
- **Branch:** `evaluate-typescript-migration` (started from `development`)
- **Roadmap step:** 12 of [0000](0000-roadmap-to-layered-architecture.md)
- **Pull request:** to be filled when opened
- **Supersedes / depends on:** none to start. The record names consequences for 0008 (deploy pipeline), 0010 (config split) and 0014 (typed client); each must be re-read if the decision differs from the recommendation. Numbers 0008, 0010 and 0014 are the ones pre-assigned to those roadmap steps and may still be Draft when this spec is reviewed.

## Context

Two open questions sit in `docs/ARCHITECTURE.md` ("Open decisions") and in roadmap step 12, and both are cheaper to settle before the delivery pipeline (step 8) and the frontend work harden around the current answers.

**Language.** The code base is plain JavaScript (ES modules, Node 24, `"type": "module"`) with no build step: `serverless.yml` points straight at `src/handlers/*.js`. It is small (about 490 lines under `src/`) and already layered (`handlers -> application -> domain`, spec 0003). Types exist only as two JSDoc blocks (`src/domain/task.js`, `src/domain/taskRepository.js`, the repository port) plus one `@implements` tag in `DynamoTaskRepository`; nothing checks them. A React frontend will consume a generated, typed client (roadmap: `generate-typed-api-client`), so the question is whether the API side should also be typed, and how.

**Deployment framework.** The stack is deployed with Serverless Framework v4 (`frameworkVersion: "4"`, `org: stivencardona` in `serverless.yml`). The README ("Prerequisites", "Troubleshooting") and `docs/ARCHITECTURE.md` already record the cost: v4 needs a Serverless account (`serverless login` or `SERVERLESS_ACCESS_KEY`), and forks that do not own the `org` cannot deploy as is. Step 8 will add a GitHub Actions deploy through an AWS OIDC role; whatever the deploy tool needs besides that role becomes a pipeline secret. Facts checked while drafting this spec (2026-10-03, to be re-checked when the record is written, see Design):

- Serverless pricing page: the CLI v4 is free for organizations under USD 2 million annual revenue, on an honor system with no proof required; above it a paid subscription is required (USD 4 per credit pay-as-you-go, lower with reserved credits). Authentication is through the Dashboard or a License Key (an environment variable, or the SSM parameter `/serverless-framework/license-key`).
- Serverless `serverless.yml` reference: `org` and `app` are optional properties; a default org is written to `.serverlessrc` after login. So the README advice "remove the line if you do not use one" matches the documentation, but login or a key is still required.
- Serverless v4 bundles TypeScript with esbuild without a plugin, and its documentation states that esbuild does not type-check and that `tsc --noEmit` belongs in CI.
- AWS SAM can build Node.js and TypeScript functions with esbuild (`Metadata: BuildMethod: esbuild`); the same page says nothing about type checking, which is again `tsc`'s job.
- Lambda supports `nodejs24.x` until 2028-04-30 (deprecation date in the Lambda runtimes table), so the runtime is not a reason to move now.
- npm today: `typescript` 7.0.2, `serverless` 4.43.0, `aws-cdk` 2.1144.0 (license Apache-2.0), `openapi-typescript` 7.13.0 with peer dependency `typescript ^5.x`. The `serverless` npm package reports no license field; its terms are the ones on the pricing page.

A throwaway trial with `typescript@5.9.3` (installed in a scratch folder, not in the repository; dependencies were not installed in that checkout, so third-party types were unresolved) ran `tsc --noEmit --allowJs --checkJs` on `src/`. Without `strict` it reported 4 errors; with `--strict`, 60, of which 55 are implicit `any` on parameters. This is indicative only; the record must repeat it on a proper install.

## Goal

Decide, with a written comparison against stated criteria, (a) how the code is typed (TypeScript, JSDoc checked by `tsc`, or unchanged) and (b) which deployment framework the project stays on (Serverless v4, AWS SAM or AWS CDK), and record the decision, its consequences and its revisit triggers in `docs/`.

## Scope

1. **Decision record** `docs/decisions/0001-typing-and-deployment-framework.md` (new folder `docs/decisions/`; the first record, ADR style: Status, Context, Decision drivers, Options, Decision, Consequences, Revisit triggers). It contains:
   - **Part A, typing.** Options: (A1) stay as is, (A2) JSDoc types checked by `tsc --noEmit` with `allowJs` and `checkJs` and no emit, (A3) migrate to TypeScript with an esbuild build. Each is judged against the criteria below and against this repository's concrete changes (see Design, table A).
   - **Part B, deployment framework.** Options: (B1) stay on Serverless Framework v4, (B2) AWS SAM, (B3) AWS CDK (TypeScript). Judged against the same criteria and against table B in Design.
   - **Criteria**, each with a weight (high, medium, low) fixed in the record before scoring: fork-friendliness (can a contributor without a paid or personal account deploy with documented steps), licensing and cost for this use, migration cost in commits and risk to deployed stages, fit with the OIDC pipeline (spec 0008) including long-lived secrets, local development and testing, maintenance burden and bus factor, effect on the layered architecture and on spec/test conventions, and effect on the frontend track (typed client, stage-specific URLs).
   - A **verified facts** table: each external claim with its source URL and the date checked (pricing, `org` optionality, esbuild support, runtime deprecation date). Anything that could not be verified is listed as such, never filled in.
   - A **migration sketch** for the runner-up of each part: ordered steps, what changes in each file, and what is explicitly not carried over, so the decision can be reversed or executed without redoing the analysis.
   - **Revisit triggers**: observable conditions that reopen each decision (for example the owner's organization passing the Serverless revenue threshold, a fork program that needs one-command deploys, a second service in the repository, a change of Serverless terms, the types check producing more suppressions than annotations).
2. **Trial evidence** in the record, run once and pasted as numbers (not committed as files): `tsc --noEmit --allowJs --checkJs` on `src/` and on `tests/`, with and without `--strict`, on a clean `npm ci` checkout, with the error counts and the main error classes.
3. **Docs that depend on the decision**, updated in the same series: `docs/ARCHITECTURE.md` ("Open decisions" resolved and linked, roadmap row 12 closed), the roadmap row in `specs/0000-roadmap-to-layered-architecture.md` (outcome and link only, no reorder), `README.md` and `CONTRIBUTING.md` only where the record changes advice (for example fork instructions), and the Spanish references (`README.es.md`, `CONTRIBUTING.es.md`, `docs/ARCHITECTURE.es.md`) with the same headings, rows and code blocks.
4. **Follow-up specs named, not written.** If the decision calls for work (adding the type check to CI, replacing the deploy tool), the record lists each as a proposed roadmap addition with a suggested branch name; adding them to the roadmap is an amendment to spec 0000 made by the maintainer.

## Out of scope

- Adding `tsc`, `typescript`, `@types/*` or any dependency, a `tsconfig.json` or `jsconfig.json`, or a CI step. If A2 is chosen, that is its own spec (`add-jsdoc-type-checking`, proposed).
- Converting any file to TypeScript, annotating code with JSDoc, or changing any handler path.
- Writing a `template.yaml` or a CDK app, changing `serverless.yml`, the smoke test or any workflow.
- Choosing the OIDC role layout or the pipeline design (spec 0008), splitting the config files (spec 0010) or generating the client (spec 0014); this record only states what each must assume.
- Moving off `nodejs24.x`, changing the region or the stage model.
- Anything about the frontend's language: React with TypeScript is assumed by the frontend track and is decided there (spec 0018).

## Design

### Evidence-based recommendation (to be confirmed or overturned by the record)

- **Typing: A2, JSDoc checked by `tsc --noEmit --checkJs`, adopted incrementally.** The code is 490 lines with no build step; the layering is already expressed through JSDoc typedefs (the repository port); the check can be added as one CI step and one devDependency without touching handler paths, packaging, Vitest, ESLint or the smoke test. A3 adds a build stage that every other part of the repository would have to learn about (handler paths in `serverless.yml`, a `dist/` or esbuild output, source maps for log readability, a typed ESLint setup, ESM and `.ts` import extensions) for a code base that has not shown a type-related defect. The frontend gets its types from the OpenAPI contract, not from the API's source language, so A3 buys no frontend benefit. The trial shows the entry cost is small without `strict` and moderate with it (mostly annotating parameters). Pin the TypeScript major to what `openapi-typescript` accepts (`^5.x` peer today), which makes the checker's version a coupling to spec 0014.
- **Framework: B1, stay on Serverless v4 for now, with named revisit triggers and SAM as the designated fallback.** Free under the USD 2 million threshold on an honor system, `org` is optional, the configuration is almost pure CloudFormation (the `resources` block is copied verbatim into any alternative), and a migration would replace the Lambda functions and the HTTP API (new API id, therefore new base URL for the frontend) for no functional gain. The honest cost is the account requirement: forks and the step 8 pipeline need a Serverless login or license key as a long-lived secret next to the OIDC role. The record must weigh that against SAM, which needs no account, uses only AWS credentials (so OIDC is the entire credential story), and keeps the same CloudFormation. If fork-friendliness or "no long-lived secrets in CI" is weighted high, SAM wins on the criteria and the record must say so; that weighting is the maintainer's call (see Decisions to confirm).

These are recommendations; the record states the weights and the scores, and the implementation of this spec must not pre-decide them differently without amending this spec.

### Table A: what each typing option changes in this repository

| Area | A1 as is | A2 JSDoc and `tsc --checkJs` | A3 TypeScript |
| --- | --- | --- | --- |
| `serverless.yml` handlers | none | none | paths still `src/handlers/x.fn`; Serverless v4 builds `.ts` handlers with esbuild per its docs, but the build output and source maps need checking |
| Packaging | classic zip | unchanged | esbuild bundle or compile step; `external` choices for the AWS SDK |
| Source layout and imports | none | none | `.ts` files; ESM import extensions policy; `src/` and `tests/` renamed |
| Tests (Vitest) | none | none | Vitest runs TypeScript, but `tests/helpers.js` and every import path change |
| ESLint 10 flat config | none | none (optionally a JSDoc plugin, not required) | typed linting needs a TypeScript parser dependency |
| Dependencies | none | `typescript`, `@types/node`, `@types/aws-lambda` (checked in a spec, AGENTS.md rule) | the same plus a build tool if not provided by the framework |
| CI | none | one step: `npm run typecheck` | typecheck plus a build step |
| Smoke test (`scripts/smoke.sh`) | none | none | none (black-box over HTTP) |
| Spec 0014 client types | consumed as `.d.ts` or via JSDoc `import()` | the natural fit: same mechanism | direct imports |
| Revert cost | n/a | delete one script and one config file | a rename and a build removal across the tree |

### Table B: what each framework changes

| Area | B1 Serverless v4 | B2 SAM | B3 CDK |
| --- | --- | --- | --- |
| Account and cost | account or license key required; free under USD 2 million revenue (honor system); paid above | no account; AWS credentials only | no account; AWS credentials only; bootstrap stack in the account |
| Infrastructure file | `serverless.yml` (about 130 lines), `resources` is CloudFormation | `template.yaml`: functions become `AWS::Serverless::Function` with `HttpApi` events and the JWT authorizer under `Auth`; the `resources` block moves over unchanged | an app in TypeScript or JavaScript that synthesizes the template; the table, pool and client become constructs |
| Handlers paths (`src/handlers/*.js`) | `handler: src/handlers/x.fn` | `CodeUri` plus `Handler: x.fn`; layout needs a decision, or esbuild entry points | `NodejsFunction` takes an entry file path |
| Packaging | built-in; esbuild for TypeScript | `sam build`; esbuild through `Metadata` | `NodejsFunction` bundles with esbuild |
| Stack and resource identity | stack `<service>-<stage>`; generated logical ids for functions and the HTTP API | stack name is free (can reuse the current one) but logical ids differ, so functions and the HTTP API are replaced (new API id) while the explicitly named table and pool keep their ids | new logical ids unless overridden; same replacement concern |
| Smoke test | reads stack outputs `UserPoolId`, `UserPoolClientId` and finds the API by name `<stage>-<service>` | the API name differs, so an `ApiUrl` stack output must replace the name lookup | same |
| OIDC pipeline (spec 0008) | OIDC role plus a Serverless access or license key secret | OIDC role only (`sam build`, `sam deploy`) | OIDC role plus bootstrap roles (`cdk deploy` assumes them) |
| Local development | `serverless dev`, `invoke local` (README "Local Development") | `sam local invoke` and `sam local start-api`, which need Docker | `cdk synth`; local invoke through SAM CLI |
| Fork experience | needs an account or key | clone, configure AWS credentials, deploy | bootstrap, then deploy |
| Spec 0010 (split config) | split `serverless.yml` into `functions/` and `resources/` files | not applicable: `template.yaml` is one file or nested stacks | not applicable: code modules |
| Risk | vendor terms may change | `sam deploy` guided config and `samconfig.toml` per stage to maintain | rewrite of declarative config into code; a new language of infrastructure |

### Method

1. Re-verify every external fact in Context on the day the record is written, citing URL and date; a fact that cannot be verified is written as unverified.
2. Fix criteria and weights in the record before scoring; score each option with one sentence of evidence per cell.
3. Run the trial (Scope item 2) on a clean checkout.
4. Write the decision with its consequences for specs 0008, 0010 and 0014, and its revisit triggers.

### Alternatives rejected for this spec's own approach

- *Prototype a SAM template to measure migration cost:* produces code that is out of scope and creates pressure to keep it. The record estimates cost from the files instead.
- *Decide only the framework, or only the language:* the two interact (esbuild builds in both frameworks, and CDK would add a TypeScript infrastructure project), so one record covers both.
- *Decide by default and skip the record:* the question has been open since spec 0000 and each later spec (0008, 0010, 0014) silently assumes an answer.

### Principles applied

- **YAGNI and KISS:** no new tool or language unless a stated criterion needs it; the smallest option that resolves the pain wins ties.
- **Decisions are recorded, not implied:** one ADR with sources and revisit triggers, so a later contributor can tell whether the reasons still hold.
- **Evidence over preference:** every claim is a repository fact, a sourced external fact, or marked unverified.

## Contract impact

| Area | Impact |
| --- | --- |
| Public API (`docs/openapi.yaml`) | none |
| Infrastructure (`serverless.yml`) | none in this change; the record may propose follow-up specs |
| Data model | none |
| Dependencies | none |
| Documentation | new `docs/decisions/0001-typing-and-deployment-framework.md`; `docs/ARCHITECTURE.md` ("Open decisions", roadmap row 12); roadmap row in spec 0000; README and CONTRIBUTING if advice changes; Spanish references; spec index row |

## Acceptance criteria

- [ ] The record exists at `docs/decisions/0001-typing-and-deployment-framework.md` and has the sections Status, Context, Decision drivers, Options, Decision, Consequences and Revisit triggers.
- [ ] It states the criteria and their weights before the scores, and compares all three typing options and all three frameworks against every criterion, with one sentence of evidence per cell.
- [ ] Table A and table B of this spec are reflected, with each "what changes" cell checked against the repository (`serverless.yml`, handler paths, packaging, `scripts/smoke.sh`, `.github/workflows/ci.yml`).
- [ ] Every external fact (pricing, revenue threshold, `org` optionality, esbuild in Serverless and SAM, runtime deprecation date, npm versions) lists its source URL and the date it was checked, and unverified items are labelled unverified.
- [ ] The `tsc` trial numbers (with and without `strict`, `src/` and `tests/`) are in the record, with the TypeScript version used.
- [ ] The record names the decision for each part, the consequences for specs 0008, 0010 and 0014, and at least three observable revisit triggers.
- [ ] A migration sketch exists for the runner-up of each part.
- [ ] The "Open decisions" items in `docs/ARCHITECTURE.md` that this record resolves are replaced by a link to it, and roadmap row 12 is marked done in `docs/ARCHITECTURE.md` and in spec 0000 without changing order.
- [ ] The Spanish references carry the same headings, rows and code blocks as the English files that changed.
- [ ] No file under `src/`, `tests/`, `scripts/`, `.github/`, `serverless.yml` or `package.json` changed.
- [ ] `npm run lint` and `npm test` pass.

## Verification

```bash
test -f docs/decisions/0001-typing-and-deployment-framework.md
grep -c "^## " docs/decisions/0001-typing-and-deployment-framework.md      # at least the seven sections
grep -n "unverified\|Checked on" docs/decisions/0001-typing-and-deployment-framework.md
git diff development --stat -- src tests scripts .github serverless.yml package.json package-lock.json   # prints nothing
grep -n "Open decisions" docs/ARCHITECTURE.md                              # resolved items link to the record
npm run lint && npm test
```

Heading parity of the Spanish files is checked by comparing `grep '^#'` output of each pair.

## Commit plan

1. Add this spec (Draft, then Approved by the maintainer).
2. Add the decision record with the verified facts, the trial numbers and the migration sketches.
3. Resolve the open decisions in `docs/ARCHITECTURE.md` and close roadmap row 12 (architecture file and spec 0000), then update README and CONTRIBUTING if the advice changed.
4. Close this spec (Implemented, pull request recorded). The Spanish references are untracked and updated alongside commit 3 without being committed.

## Risks and rollback

- **Risk:** vendor terms change between drafting and writing. Mitigated by re-verifying on the day and dating each fact; the revisit triggers include a change of terms.
- **Risk:** the record becomes a justification of a prior preference. Mitigated by fixing weights before scores and by a spec acceptance criterion that every cell has evidence.
- **Risk:** the recommended decisions create follow-up work nobody schedules. Mitigated by naming each follow-up with a branch name; adding it to the roadmap is the maintainer's amendment.
- **Risk:** the `tsc` trial depends on the TypeScript version (5.9.3 in the draft trial, 7.0.2 current). The record states the version used and the compatibility with `openapi-typescript`.
- **Rollback:** documentation only. Revert the merge; nothing deployed depends on it.

## Decisions to confirm

| # | Decision | Recommended default |
| --- | --- | --- |
| 1 | Typing | Option A2: JSDoc checked by `tsc --noEmit --checkJs`, adopted incrementally, no TypeScript migration; implemented by a follow-up spec |
| 2 | Framework | Stay on Serverless Framework v4 now; SAM is the documented fallback, with revisit triggers (revenue threshold, a fork program, a change of terms) |
| 3 | Weight of fork-friendliness and of "no long-lived CI secrets" | Medium. If you raise either to high, the record's scoring will recommend SAM |
| 4 | Location and naming of decision records | `docs/decisions/NNNN-title.md`, English only, with Spanish mirrors not required (records are not user-facing guides); alternatively mirror like the other docs |
| 5 | Whether the proposed follow-up specs are added to the roadmap by this change | No; the record proposes them and the maintainer amends spec 0000 separately |

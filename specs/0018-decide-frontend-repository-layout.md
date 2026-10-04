# 0018: Decide where the frontend lives and how it ships

- **Status:** Implemented
- **Branch:** `decide-frontend-repository-layout` (started from `development`)
- **Roadmap step:** Frontend readiness track of [0000](0000-roadmap-to-layered-architecture.md), item "Frontend home"
- **Pull request:** to be filled when opened
- **Supersedes / depends on:** none to start. The record must be consistent with spec 0014 (typed client from `docs/openapi.yaml`), spec 0015 (SPA Cognito app client with the hosted UI and PKCE), the deploy pipeline of roadmap step 8 (spec 0008), the CORS item (`add-explicit-cors-origins`) and spec 0017 (versioning policy). It does not need any of them merged; where it assumes something from them it says so. It shares the `docs/decisions/` folder with spec 0016 (see Decisions to confirm).

## Context

Spec 0000 says the frontend comes after the API is stable and asks for a decision record before any frontend code: a `web/` directory in this repository or a separate repository, how it is built, tested and deployed (for example S3 and CloudFront) and how it consumes the generated client. Everything the frontend needs is shaped by facts already in this repository:

- **One contract, one source of truth.** `docs/openapi.yaml` is the API contract, and spec 0014 will generate the client from it. A contract change and the client change that follows are one logical change when they live in one repository (`AGENTS.md`: "Changing a route, status code or field updates `docs/openapi.yaml` and the README API tables in the same change").
- **One process.** `AGENTS.md`, `specs/README.md` and `CONTRIBUTING.md` define a spec-driven flow with a single maintainer, atomic commits, English specs, and untracked Spanish mirrors (`README.es.md`, `CONTRIBUTING.es.md`, `docs/ARCHITECTURE.es.md`, excluded through `.git/info/exclude`). A second repository would need its own copy of all of it or a cross-repository rule.
- **One branch model.** `development -> staging -> production -> main`, with stages `dev`, `staging` and `prod` deployed by `serverless deploy --stage <name>` (README, "Branching and Release Workflow"). CI (`.github/workflows/ci.yml`) has a single job, `lint-and-test`, that runs `npm ci`, `npm run lint` and `npm test` with Node 24 on pushes and pull requests to the four branches.
- **Root tooling would see a frontend.** The root `package.json` has no `workspaces` and declares `engines.node >= 22`; `eslint.config.js` and `vitest.config.js` are root-level; `serverless.yml` has no `package:` block, so nothing today tells the Serverless packager to leave a `web/` directory out of a Lambda artifact. `.gitignore` lists only `node_modules`, `.serverless` and `CLAUDE.md`.
- **The API needs the frontend's origin.** `README.md` ("Known Limitations") records "No CORS configuration"; the CORS item will need the allowed origin of each stage, which for a CloudFront-hosted app is the distribution domain. Spec 0015 needs callback and logout URLs per stage, which are the same domain. And the existing JWT authorizer in `serverless.yml` has `audience: [!Ref UserPoolClient]`, a single client id, so a second (SPA) app client's tokens are rejected unless the audience list is extended; with a Cognito ID token the `aud` claim is the app client id (to be re-verified in spec 0015).

Facts checked while drafting (2026-10-03):

- AWS documents origin access control (OAC) as the recommended way for CloudFront to read a private S3 bucket (bucket policy granting the `cloudfront.amazonaws.com` service principal, restricted by `AWS:SourceArn` of the distribution), and says OAC cannot be used with an S3 bucket configured as a website endpoint.
- npm today: `vite` 8.3.2 (engines `^20.19.0 || >=22.12.0`), `react` 19.3.0, `vitest` 5.0.3 (the version the backend already uses), `@vitejs/plugin-react` 6.1.1, `openapi-fetch` 0.17.0, `oidc-client-ts` 3.5.0. The root `engines` of `>=22` therefore does not guarantee Vite's minimum; the frontend must declare its own `engines`.
- `openapi-typescript` 7.13.0 requires TypeScript `^5.x` as a peer dependency, while `typescript` is at 7.0.2: the frontend's TypeScript version must be chosen to satisfy it. The generated types are TypeScript, so the frontend is written in TypeScript regardless of the backend decision in spec 0016.
- Not verified, to be confirmed in the record: that CloudFront custom error responses mapping `403` and `404` to `/index.html` with status `200` give the single-page fallback for an OAC-protected bucket; how a path-filtered GitHub workflow interacts with required status checks; whether this repository has branch protection requiring the `lint-and-test` check; and what Serverless Framework v4 includes in a function package by default.

## Goal

Decide, with a written comparison, where the React frontend lives and how it is built, tested, configured, deployed per stage and kept inside the repository's spec process and documentation convention, and record the decision and its consequences for the existing CI and branch workflow.

## Scope

1. **Decision record** `docs/decisions/0002-frontend-repository-layout.md` (ADR style: Status, Context, Decision drivers, Options, Decision, Consequences, Revisit triggers), covering:
   - **Location.** Options: (L1) a `web/` directory in this repository with its own `package.json` and lockfile, not an npm workspace; (L2) a `web/` npm workspace of the root `package.json`; (L3) a separate repository. Criteria, weighted before scoring: contract and client change in one atomic change, fit with the spec process and `AGENTS.md`, effect on the backend's packaging and CI time, effect on forks and contributors, independence of release cadence, permissions and blast radius, ease of extracting later.
   - **Build and tooling.** The build tool, test runner, language and Node version, with evidence (Vite, Vitest with Testing Library, TypeScript at the version `openapi-typescript` accepts, own `engines`), and what is deliberately not chosen yet (router, state library, UI kit: decided in the frontend implementation specs, not here).
   - **Hosting and delivery per stage.** S3 (private, OAC) plus CloudFront, one pair per stage, defined in a CloudFormation template of its own (not in `serverless.yml`), with the SPA fallback, cache headers (hashed assets cacheable for a long time, `index.html` not cached), security headers (a response headers policy) and invalidation on deploy. Alternatives: S3 website endpoint, Amplify Hosting, third-party static hosts, adding the resources to the API stack.
   - **Deploy order and the circular dependency.** The CloudFront domain is needed by the API (allowed CORS origin, Cognito callback and logout URLs) and the API's outputs (URL, client id, hosted UI domain) are needed by the frontend build. The record fixes the order of the three steps (web infrastructure stack, API stack, web content) and how each reads the other's outputs (stack outputs, as `scripts/smoke.sh` already reads `UserPoolId` and `UserPoolClientId`).
   - **Environment configuration.** Which values the frontend needs (API base URL, Cognito hosted UI domain, SPA app client id, region) and how they reach it: build-time `VITE_*` values resolved per stage from stack outputs, versus a runtime `config.json` served beside `index.html`. States that none of them is a secret (public client, authorization code with PKCE, no client secret) and that nothing is committed (`AGENTS.md` security rules).
   - **Consuming the typed client (spec 0014) and the hosted UI sign-in (spec 0015).** The generated client's location and regeneration rule (regenerate from `docs/openapi.yaml`, CI fails if the committed output differs, if it is committed), the attach point for the bearer token, which token the API accepts (to be aligned with the authorizer audience), and the rules for handling `401`, an invalid `nextToken` and unknown response fields from spec 0017. Library choices for the sign-in flow and token storage stay with spec 0015 and its implementation.
   - **CI and branches.** What changes in `.github/workflows/ci.yml` (a second job `web`, same triggers, Node version, `npm ci` and the web lint, test and build), the required-check consequence of path filters, how a release moves through the four branches with the frontend in it, and the order of an API-then-web deployment given that the API only changes additively (spec 0017).
   - **Specs and docs convention.** Specs stay in the root `specs/` folder, English only, with `web/` in the Scope of the ones that touch it; the frontend's own `README.md` is English and tracked, with an untracked Spanish `web/README.es.md` mirror following `AGENTS.md`; `AGENTS.md` gets a short Frontend section when `web/` exists; the UI's own language (Spanish, English, or both) is a product decision outside this record.
   - **Consequences and a follow-up list**, each with a proposed branch name: scaffold `web/` and its CI job; web infrastructure template; deploy workflow addition to the OIDC pipeline; first screens. They are proposed roadmap additions, not written here.
   - **Verified and unverified facts**, each with source and date.
2. **Docs that depend on the decision**: `docs/ARCHITECTURE.md` (a short "Frontend" subsection in the target architecture and the row of the frontend track), spec 0000 (outcome link on the "Frontend home" row, no reorder), `README.md` (project structure mention and a link), `CONTRIBUTING.md` (one paragraph: where frontend work goes and that it follows the same spec and branch rules), `AGENTS.md` (one bullet pointing to the record), and the Spanish references with the same headings, rows and code blocks.

## Out of scope

- Creating `web/`, a `package.json`, a Vite or React project, a `.gitignore` entry, or any frontend code (a follow-up spec).
- The CloudFormation template for the bucket and distribution, the deploy job, any change to `ci.yml`, the OIDC role or `serverless.yml` (follow-up specs; the OIDC pipeline is roadmap step 8).
- CORS settings, the SPA app client, callback URLs and the authorizer audience (the CORS item and spec 0015). The record states the values they must receive.
- Generating the client (spec 0014) and the choice of its library (`openapi-typescript`, `openapi-fetch` or others).
- A custom domain, certificates and DNS. The record assumes the default CloudFront domain per stage and says what changes with a custom domain.
- Router, state management, UI kit, internationalization of the UI, accessibility targets and end-to-end browser tests: frontend implementation specs.
- Changing the backend language or deployment framework: spec 0016.

## Design

### Recommendation (to be confirmed or overturned by the record)

- **Location: L1.** `web/` in this repository, self-contained (own `package.json`, lockfile, `engines`, ESLint and Vitest configuration), **not** an npm workspace. Evidence: contract and client change atomically; the spec process, `AGENTS.md`, the PR template and the four-branch promotion already exist and apply unchanged; a single maintainer gains nothing from a second repository's overhead; the generated client needs `docs/openapi.yaml` next to it. A workspace (L2) is rejected because the root has none, a shared lockfile and hoisting would couple the backend's `npm ci` (and Lambda packaging) to frontend dependencies, and the benefit (shared dependencies) does not exist (the backend has no frontend code in common). A separate repository (L3) is rejected for now because it needs the contract published (an OpenAPI artifact or a client package), cross-repository specs, duplicated rules and two PRs for one contract change; it is the right answer if release cadence or access control ever diverges, and that is a listed revisit trigger. Extraction later is cheap because `web/` has no imports from the backend and the backend has none from `web/`.
- **Tooling:** TypeScript with Vite, React, and Vitest with Testing Library, with the TypeScript major constrained by `openapi-typescript` (peer `^5.x` today); Node declared in `web/package.json` `engines` to satisfy Vite (>= 22.12), independent of the root `>=22`. The backend keeps JavaScript (decision in spec 0016): the two sides meet only at the OpenAPI file.
- **Hosting: private S3 bucket plus CloudFront with OAC per stage**, in its own CloudFormation stack named per stage (for example `aws-lambda-crud-nodejs-web-<stage>`), deployed with the AWS CLI rather than a second Serverless service: this keeps the frontend independent of the Serverless account question (spec 0016) and gives it its own lifecycle (deleting or redeploying the web stack never touches the table or the user pool). CloudFront maps `403` and `404` to `/index.html` with `200` for client-side routes (to be verified), and a response headers policy adds the security headers.
- **Order and configuration:** web infrastructure stack first (it yields the distribution domain), API stack second (reads the domain for CORS origins and Cognito callback URLs; also allows `http://localhost:<port>` in `dev` only), web content last (build reads the API stack outputs and writes them into the build as `VITE_*` values, the same way `scripts/smoke.sh` resolves outputs). Build-time configuration per stage is recommended over a runtime `config.json` for simplicity, because the four-branch flow already rebuilds per stage; the record states the trade-off (one artifact for all stages versus one fewer request and no config file to serve).
- **CI:** add a second job `web` to the existing `ci.yml`, same triggers, that runs only the frontend's `npm ci`, lint, tests and build, so the existing `lint-and-test` job and its required-check name stay untouched. Prefer not using path filters on the workflow (a skipped workflow can leave a required check pending; to be verified), accepting that the job runs on backend-only changes; the cost is small and decided by measurement in the record.
- **Backend packaging:** the scaffold spec must add a `package:` exclusion for `web/**` (and for `docs/`, `specs/`, `tests/`, `scripts/` if the record's check shows they are included), with an acceptance check on the produced artifact. This is the single place where adding `web/` can break the existing system.
- **Release flow:** the four branches carry both; a release deploys API first, then web, which is safe because the API changes additively between majors (spec 0017: old clients keep working). The reverse order is not safe and the record says so.
- **Docs and specs:** specs in `specs/`, English; `web/README.md` English with an untracked Spanish mirror; spec numbers stay one sequence.

### Alternatives rejected for this spec's approach

- *Scaffold `web/` now to learn the answer:* produces frontend code before the contract is stable (spec 0000) and before specs 0014 and 0015; the record is cheaper and reversible.
- *Fold the decision into spec 0014 or 0015:* the layout affects CI, packaging, hosting and docs, not only the client or the sign-in.
- *Decide only the repository location and leave hosting open:* the hosting decision is what forces the circular-dependency order, which in turn fixes what specs 0015 and the CORS item must output.

### Principles applied

- **KISS and YAGNI:** no workspace, no runtime config service, no custom domain, no framework choices beyond what the contract requires, until a need is shown.
- **Dependency direction:** the frontend depends on the OpenAPI contract; the backend never depends on the frontend. The only shared artifact is `docs/openapi.yaml`.
- **Blast-radius separation:** a separate stack for static hosting; a separate package for the frontend.

## Contract impact

| Area | Impact |
| --- | --- |
| Public API (`docs/openapi.yaml`) | none |
| Infrastructure (`serverless.yml`) | none in this change; the record lists the future changes (exclusion of `web/**` from the package, authorizer audience, CORS origins, callback URLs) and who makes them |
| Data model | none |
| Dependencies | none |
| Documentation | new `docs/decisions/0002-frontend-repository-layout.md`; `docs/ARCHITECTURE.md`, spec 0000 row, `README.md`, `CONTRIBUTING.md`, `AGENTS.md`; Spanish references; spec index row |

## Acceptance criteria

- [x] The record exists at `docs/decisions/0002-frontend-repository-layout.md` with the sections Status, Context, Decision drivers, Options, Decision, Consequences and Revisit triggers.
- [x] It fixes the criteria and weights before scoring and compares L1, L2 and L3 against each criterion with one sentence of evidence per cell, naming the repository files each claim rests on (`package.json`, `serverless.yml`, `.github/workflows/ci.yml`, `AGENTS.md`).
- [x] It decides build tool, test runner, language and Node version, hosting and the per-stage layout, the three-step deploy order with how each step reads the others' outputs, the environment configuration mechanism, and the CI and branch consequences.
- [x] It states how the frontend consumes the typed client (spec 0014) and the hosted UI sign-in (spec 0015), including which token the API accepts given the authorizer audience in `serverless.yml`, and the client rules derived from spec 0017.
- [x] It states how the spec process, `AGENTS.md` and the English and Spanish documentation convention extend to `web/`.
- [x] It names the one packaging risk (`web/` in the Lambda artifact) and the acceptance check the scaffold spec must carry.
- [x] Every external fact lists its source and the date checked; the unverified ones listed in Context are either verified or labelled unverified.
- [x] It lists the follow-up specs with proposed branch names and at least three revisit triggers (for example a second maintainer or release cadence, a need for a custom domain, build time or CI cost).
- [x] Docs listed in Scope item 2 are updated.
- [ ] The Spanish references match their English files in headings, rows and code blocks. (Untracked files, mirrored by the maintainer after this change.)
- [x] No file under `src/`, `tests/`, `scripts/`, `.github/workflows/`, `serverless.yml`, `package.json` or `docs/openapi.yaml` changed, and no `web/` directory exists.
- [x] `npm run lint` and `npm test` pass.

## Verification

```bash
test -f docs/decisions/0002-frontend-repository-layout.md
grep -c "^## " docs/decisions/0002-frontend-repository-layout.md          # at least the seven sections
grep -n "unverified\|Checked on" docs/decisions/0002-frontend-repository-layout.md
grep -n "web/\*\*\|package:" docs/decisions/0002-frontend-repository-layout.md   # the packaging risk is named
test ! -e web
git diff development --stat -- src tests scripts .github/workflows serverless.yml package.json docs/openapi.yaml   # prints nothing
npm run lint && npm test
```

Heading parity of the Spanish files is checked by comparing the `grep '^#'` output of each pair.

## Commit plan

1. Add this spec (Draft, then Approved by the maintainer).
2. Add the decision record with the verified facts and the follow-up list.
3. Update `docs/ARCHITECTURE.md`, spec 0000, `README.md`, `CONTRIBUTING.md` and `AGENTS.md` to point at it.
4. Close this spec (Implemented, pull request recorded). The Spanish references are untracked and updated alongside commit 3 without being committed.

## Risks and rollback

- **Risk:** the decision is made before specs 0014 and 0015 are implemented, so the record's assumptions about the client location and the token may be wrong. Mitigated by stating each assumption in the record and by listing the specs that must re-read it; the record is amended in its own commit if they differ.
- **Risk:** putting `web/` in the repository slows the backend's CI or bloats its Lambda package. Mitigated by the separate `web` job, no workspace, and the packaging acceptance check carried by the scaffold spec.
- **Risk:** the circular dependency between the web and API stacks is mishandled and a deploy order trap appears (an API stack referencing a domain that does not exist yet). Mitigated by fixing the order in the record and keeping the web stack independent.
- **Risk:** a monorepo makes a later split costly. Mitigated by no imports across the two sides and a documented revisit trigger.
- **Risk:** the Spanish mirror convention is untracked and easy to forget for a new folder. Mitigated by naming `web/README.es.md` in the record and in the scaffold spec.
- **Rollback:** documentation only. Revert the merge; nothing deployed depends on it.

## Decisions to confirm

| # | Decision | Recommended default |
| --- | --- | --- |
| 1 | Location | `web/` in this repository, self-contained, not an npm workspace |
| 2 | Hosting | Private S3 plus CloudFront with OAC per stage, in a separate CloudFormation stack deployed with the AWS CLI, no custom domain yet |
| 3 | Configuration | Build-time `VITE_*` values per stage taken from stack outputs; no runtime `config.json` |
| 4 | CI | A second `web` job in `ci.yml`, no path filters; `lint-and-test` unchanged |
| 5 | Shared `docs/decisions/` folder with spec 0016 | Numbered records in one folder (0016 writes `0001`, this writes `0002`); whichever merges first creates the folder, the other rebases |

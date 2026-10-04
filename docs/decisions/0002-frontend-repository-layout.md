# 0002: Frontend repository layout and delivery

- **Date:** 2026-10-03
- **Governing spec:** [0018](../../specs/0018-decide-frontend-repository-layout.md), item "Frontend home" of the frontend track in [0000](../../specs/0000-roadmap-to-layered-architecture.md)

## Status

Accepted. The maintainer approved spec 0018, including the outcomes recorded under Decision.

## Context

A React frontend will consume this API. Spec 0000 asks where it lives, how it is built, tested and deployed, and how it consumes the generated client, before any frontend code exists. The facts that shape the answer are in this repository:

- **One contract.** `docs/openapi.yaml` is the API contract and spec 0014 will generate the client from it. `AGENTS.md` already requires a route, status code or field change to update the contract and the README in the same change.
- **One process.** `AGENTS.md`, `specs/README.md` and `CONTRIBUTING.md` define a spec-driven flow for one maintainer: English specs, atomic commits, merge-commit promotion, and untracked Spanish mirrors (`README.es.md`, `CONTRIBUTING.es.md`, `docs/ARCHITECTURE.es.md`).
- **One branch model.** `development -> staging -> production -> main`, with stages `dev`, `staging` and `prod` deployed by `serverless deploy --stage <name>`. CI (`.github/workflows/ci.yml`) has a single job, `lint-and-test`, running `npm ci`, `npm run lint` and `npm test` on Node 24 for pushes and pull requests to the four branches.
- **Root tooling.** The root `package.json` has no `workspaces` and `engines.node >= 22`; `eslint.config.js` and `vitest.config.js` are root-level.
- **Packaging.** `serverless.yml` has no `package:` block. Serverless v4 includes everything in the service directory in the function package except its default exclusions (see Verified facts), so anything added to the repository root, `web/node_modules` and `web/dist` included, would end up in the Lambda artifact.
- **The API needs the frontend's origin.** The README lists "No CORS configuration" as a limitation, the CORS item needs the allowed origin of each stage, and spec 0015 needs callback and logout URLs per stage; for a CloudFront-hosted app these are the distribution domain. The authorizer in `serverless.yml` has `audience: [!Ref UserPoolClient]`, a single client id, so tokens issued to a second (SPA) app client are rejected until the audience list is extended.

## Decision drivers

Weights are fixed here, before scoring: high = 3, medium = 2, low = 1. Scores: Good = 2, Fair = 1, Poor = 0.

| Criterion | Weight |
| --- | --- |
| A contract change and the client change that follows are one atomic change | high |
| Fit with the spec process and `AGENTS.md` (one set of rules) | high |
| Effect on the backend's packaging and CI time | medium |
| Effect on forks and contributors | medium |
| Independence of release cadence | low |
| Permissions and blast radius | low |
| Ease of extracting later | low |

## Verified facts

Checked on 2026-10-03.

| Claim | Source |
| --- | --- |
| AWS recommends origin access control (OAC) for CloudFront to read a private S3 bucket: a bucket policy grants the `cloudfront.amazonaws.com` service principal, restricted by `AWS:SourceArn` to the distribution; OAC cannot be used with an S3 website endpoint | https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html |
| CloudFront can return a different status code than the origin's with a custom error page, for example `200`; the codes it can return include `200`, `403` and `404` | https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/custom-error-pages-response-code.html |
| When a workflow is skipped by path filters, its required checks stay "Pending" and block merging; GitHub advises not requiring workflows that can be skipped | https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks |
| Serverless v4 includes everything in the service directory in the function package except `.git/**`, `.gitignore`, `.DS_Store`, log files, `.serverless/**`, `.serverless_plugins/**` and the config file, and excludes development dependencies; `package.patterns` with `!` prefixes controls the rest | https://www.serverless.com/framework/docs/providers/aws/guide/packaging |
| npm: `vite` 8.3.2 (engines `^20.19.0 \|\| >=22.12.0`), `react` 19.3.0, `vitest` 5.0.3, `@vitejs/plugin-react` 6.1.1, `openapi-fetch` 0.17.0, `oidc-client-ts` 3.5.0, `typescript` 7.0.2, `openapi-typescript` 7.13.0 with peer `typescript ^5.x` | `npm view <package>` |

**Unverified.** The following were not confirmed from a primary source: that an OAC-protected bucket without `s3:ListBucket` returns `403` (rather than `404`) for a missing object, which is why the fallback maps both; whether this repository has branch protection requiring the `lint-and-test` check (the GitHub CLI was not available to read it); that the `aud` claim of a Cognito ID token is the app client id while an access token carries `client_id` instead (left to spec 0015 to verify); that Serverless variable resolution can read another stack's outputs (`${cf:<stack>.<output>}`) for the API stack to read the web stack domain (to be verified in the follow-up spec that adds it); Amplify Hosting and third-party static hosts were not evaluated in depth, including their pricing.

## Options

### Location

- **L1.** A `web/` directory in this repository with its own `package.json`, lockfile, `engines`, ESLint and Vitest configuration, not an npm workspace.
- **L2.** A `web/` npm workspace of the root `package.json`.
- **L3.** A separate repository.

| Criterion (weight) | L1 | L2 | L3 |
| --- | --- | --- | --- |
| Atomic contract and client change (3) | Good: one pull request changes `docs/openapi.yaml` and the client | Good: the same | Poor: the contract must be published (an OpenAPI artifact or a client package) and two pull requests are needed |
| Spec process and `AGENTS.md` (3) | Good: one `specs/` folder, one PR template, one branch model | Good: the same | Poor: duplicated rules or a cross-repository rule, and specs that span two repositories |
| Backend packaging and CI (2) | Fair: needs a `package:` exclusion and a separate CI job, but the root install is untouched | Poor: a shared lockfile and hoisting couple the root `npm ci` and the Lambda package to frontend dependencies | Good: nothing changes in this repository |
| Forks and contributors (2) | Good: one clone, the frontend toolchain only for those who touch `web/` | Fair: every contributor installs frontend dependencies with `npm ci` at the root | Fair: two repositories to fork and keep in sync |
| Release cadence independence (1) | Fair: same branches, but its own stack and deploy job | Fair: the same | Good |
| Permissions and blast radius (1) | Fair: same repository access, separate deploy roles | Fair: the same | Good: separate access and CI secrets |
| Ease of extracting later (1) | Good: `web/` imports nothing from the backend and the backend nothing from `web/` | Fair: the shared lockfile has to be split | Good |
| **Weighted total** | 6 + 6 + 2 + 4 + 1 + 1 + 2 = **22** | 6 + 6 + 0 + 2 + 1 + 1 + 1 = **17** | 0 + 0 + 4 + 2 + 2 + 2 + 2 = **12** |

### Hosting

| Option | Assessment |
| --- | --- |
| **H1.** Private S3 bucket and CloudFront with OAC, one pair per stage, in a CloudFormation stack of its own, deployed with the AWS CLI | Recommended by AWS for private S3 origins; the bucket stays private; its lifecycle is independent of the API stack and of the Serverless account question (spec 0016) |
| **H2.** The same resources in `serverless.yml` | One tool, but a frontend redeploy becomes an API stack update, deleting the stack deletes the site, and it enlarges the file that spec 0010 is splitting |
| **H3.** S3 website endpoint as the origin | Cannot use OAC (AWS), so the bucket would have to be public |
| **H4.** Amplify Hosting or a third-party static host | Adds a vendor and an account next to AWS, which is the same problem as the Serverless account; not evaluated in depth |

### Configuration

| Option | Assessment |
| --- | --- |
| **C1.** Build-time `VITE_*` values per stage | Simplest; the four-branch flow already builds per stage; the values are public and nothing is committed |
| **C2.** A runtime `config.json` served beside `index.html` | One artifact for every stage and no rebuild to change a value, at the cost of one more request before the app starts and a file to serve and cache correctly |

## Decision

- **Location: L1.** `web/` in this repository, self-contained, **not** an npm workspace (22 against 17 and 12). The decisive points are atomic contract and client changes and a single process for a single maintainer; the workspace is rejected because the root has none and the shared lockfile would couple the backend to the frontend for no shared dependency; a separate repository is rejected for now because it needs the contract published and splits the process.
- **Build and tooling.** TypeScript, Vite, React, and Vitest with Testing Library. The generated types are TypeScript, so the frontend is written in TypeScript regardless of the backend (JavaScript with JSDoc, [record 0001](0001-typing-and-deployment-framework.md)). The TypeScript major follows what `openapi-typescript` accepts (peer `^5.x` today). `web/package.json` declares its own `engines` (Vite needs Node `^20.19.0 || >=22.12.0`, stricter than the root's `>=22`). Router, state library and UI kit are not chosen here.
- **Hosting: H1.** Private S3 and CloudFront with OAC per stage, in a stack named per stage (for example `aws-lambda-crud-nodejs-web-<stage>`), deployed with the AWS CLI. CloudFront maps `403` and `404` to `/index.html` with status `200` for client-side routes. Cache headers: hashed assets cacheable for a long time, `index.html` not cached; a response headers policy adds security headers; deploy syncs the build and invalidates `index.html`. No custom domain yet: the default CloudFront domain per stage; a custom domain would change the origins, callback URLs and certificate and needs its own spec.
- **Deploy order and the circular dependency.** The CloudFront domain is needed by the API (CORS origin, Cognito callback and logout URLs) and the API's outputs (URL, SPA client id, hosted UI domain, region) are needed by the frontend build. Order: (1) the web infrastructure stack, which outputs the distribution domain; (2) the API stack, which reads that domain; `http://localhost:<port>` is also allowed in `dev` only; (3) the web content build and upload, which reads the API stack outputs the way `scripts/smoke.sh` already reads `UserPoolId` and `UserPoolClientId`. Destroying runs in the reverse order.
- **Configuration: C1.** `VITE_API_URL`, `VITE_COGNITO_DOMAIN`, `VITE_COGNITO_CLIENT_ID` and `VITE_REGION` are resolved per stage from stack outputs when the build runs and baked into the bundle. None of them is a secret (public client, authorization code with PKCE, no client secret). Nothing is committed: `web/.env*` files are git-ignored by the scaffold spec, as `AGENTS.md` requires.
- **Typed client and sign-in.**
  - The generated client lives in `web/` (location decided by spec 0014) and is regenerated from `docs/openapi.yaml`; if its output is committed, a CI step regenerates it and fails on a difference.
  - The client attaches the bearer token in one place. The authorizer validates the `aud` claim against `audience`, which today lists only `UserPoolClient`: spec 0015 must add the SPA app client there, and the frontend sends the token type that carries that audience. Spec 0015 verified it: an ID token carries the client id in `aud` and an access token in `client_id`, and the authorizer accepts both, so the browser app sends the access token, which carries no email or profile data.
  - Rules from [`docs/API_VERSIONING.md`](../API_VERSIONING.md): treat ids as opaque, restart a listing on a `400` for a stored `nextToken`, ignore unknown response fields, handle any `4xx` and `5xx` through `message`, and read `Deprecation` and `Sunset` headers once CORS exposes them.
  - Sign-in library choice (for example `oidc-client-ts` or an AWS library) and token storage belong to spec 0015 and its implementation.
- **CI and branches.** Add a second job, `web`, to `.github/workflows/ci.yml` with the same triggers, running only the frontend's `npm ci`, lint, tests and build; `lint-and-test` and its check name are untouched. No path filters: a skipped required check stays pending (verified), and the cost of running a small job on backend-only changes is accepted. A release moves through the four branches carrying both; each deploy runs API first, then web, which is safe because the API only changes additively inside a major version (old clients keep working); web first is not safe.
- **Backend packaging.** The scaffold spec must add a `package:` exclusion for `web/**` in `serverless.yml` (and for any other directory that the `serverless package` listing shows is included without need, such as `docs/`, `specs/`, `tests/` and `scripts/`), with an acceptance check on the produced artifact. This is the single place where adding `web/` can break the existing system.
- **Specs and docs.** Specs stay in the root `specs/` folder, English only, with `web/` named in the Scope of any spec that touches it, one number sequence. `web/README.md` is English and tracked; `web/README.es.md` is an untracked Spanish mirror, excluded through `.git/info/exclude` like the others. `AGENTS.md` gets a short Frontend section when `web/` exists. The language of the user interface (Spanish, English or both) is a product decision outside this record.

## Consequences

- Follow-up specs, proposed (not in the roadmap until the maintainer amends spec 0000):
  - `scaffold-react-web-app`: create `web/`, its tooling, the `.gitignore` entries, the `package:` exclusion, the `web` CI job and `web/README.md`.
  - `add-web-hosting-stack`: the CloudFormation template for the bucket, OAC, distribution, error mapping and response headers policy, and its stage naming.
  - `add-web-deploy-workflow`: build, sync and invalidate for each stage through the OIDC role of roadmap step 8, with its own least-privilege permissions.
  - `build-task-list-screen`: the first screen on the typed client and the sign-in.
- The CORS item and spec 0015 receive the web stack's domain per stage as an input, so the web infrastructure stack must exist before the API stack is deployed with them.
- The existing `lint-and-test` job, the four-branch promotion, the PR template and the spec process are unchanged for backend work.
- Frontend-only changes still travel through the four branches, which costs the maintainer promotion pull requests; accepted for one consistent flow.

## Revisit triggers

- A second maintainer, or a frontend release cadence that needs to differ from the API's.
- A need for access control that separates frontend contributors from infrastructure access.
- Frontend build time or CI cost that makes the `web` job a bottleneck for backend changes.
- A custom domain or a second frontend (for example an admin app).
- A decision to publish the API contract or a client package for third parties, which favors a separate repository.

## Documents that depend on this record

- `docs/ARCHITECTURE.md`: a short Frontend subsection and the frontend track.
- `specs/0000-roadmap-to-layered-architecture.md`: the "Frontend home" row links this record.
- `README.md`, `CONTRIBUTING.md` and `AGENTS.md`: point to it.

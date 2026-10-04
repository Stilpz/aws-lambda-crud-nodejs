# Changelog

All notable changes to the Tasks API and its deployment are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) with an extra **Upgrade notes** heading, and the version numbers follow the rules in [`docs/API_VERSIONING.md`](docs/API_VERSIONING.md): the git tag, `info.version` in [`docs/openapi.yaml`](docs/openapi.yaml) and the heading below are always the same number.

## [Unreleased]

Planned as `1.2.0`: the changes below are merged to `development` and not yet released. Compatibility class: **operational** for the table change (see Upgrade notes) and **non-breaking** for the new `PATCH` route and the deprecation of `PUT`; the highest class is minor, so `1.2.0` stands.

### Added

- Application layer: one use case per operation (`createTask`, `getTask`, `listTasks`, `updateTask`, `deleteTask`), a composition root (`src/container.js`) and thin handlers under `src/handlers/` ([spec 0003](specs/0003-add-task-use-cases.md)). No API change.
- A single error-mapping boundary for the task handlers ([spec 0004](specs/0004-standardize-error-responses.md)). Error bodies are unchanged: `{ "message": "..." }`, plus `errors` on validation failures.
- A version 7 UUID generator in `src/infrastructure/uuidV7.js` ([spec 0006](specs/0006-redesign-task-table-keys.md)).
- A smoke test check that a task appears in the listing immediately after it is created.
- CORS on the HTTP API with explicit origins per stage (`stages.<stage>.params.webOrigins`), the `Authorization` and `Content-Type` headers, the methods of the API and the exposed `Deprecation` and `Sunset` headers; no wildcard and no credentials ([spec 0013](specs/0013-add-explicit-cors-origins.md)). Browsers on an allowed origin can now call the API.
- The API versioning and deprecation policy, [`docs/API_VERSIONING.md`](docs/API_VERSIONING.md), and this changelog ([spec 0017](specs/0017-define-api-versioning-policy.md)).
- Observability ([spec 0009](specs/0009-add-observability-with-powertools.md)): structured JSON logs with a `correlation_id` (the API Gateway request id), X-Ray tracing including DynamoDB calls, a `ColdStart` metric, and CloudWatch alarms on API 5xx, Lambda throttles and p95 latency that notify an SNS topic. No API change.

- `PATCH /tasks/{id}`: the partial update, answering `200` with the updated task. It takes the same body and has the same errors as `PUT` ([spec 0012](specs/0012-add-patch-task-route.md)).

- A typed client generated from the contract: `api-client/schema.d.ts` (TypeScript declarations from `docs/openapi.yaml`, with `openapi-typescript`) and `api-client/client.js` (`createApiClient`, over `openapi-fetch`), with `api:generate`, `api:check` and `api:typecheck` scripts that CI runs so the generated types cannot drift from the contract ([spec 0014](specs/0014-generate-typed-api-client.md)). Tooling only: no API change, and the folder is excluded from the Lambda packages.
- A Cognito app client for browser apps with the hosted sign-in (user pool domain, authorization code flow with PKCE, scopes `openid` and `email`, no password flow, access and ID tokens of 60 minutes, a 7 day rotated refresh token), the stack outputs `SpaClientId` and `HostedUiBaseUrl`, per-stage callback and logout URLs (`spaCallbackUrls`, `spaLogoutUrls`), and `scripts/pkce-login.mjs` for a manual end-to-end check ([spec 0015](specs/0015-add-spa-cognito-app-client.md)). The JWT authorizer now also accepts tokens of this client. Compatibility class: **non-breaking** (the authorizer accepts more, nothing is removed); the existing client and its flows are unchanged. The deploy creates a new resource type, `AWS::Cognito::UserPoolDomain`, so the role that deploys needs permission for it.

### Changed

- `GET /tasks` is now strongly consistent: a task created or updated is listed immediately. Before, the listing read a secondary index and could miss a task created a moment earlier.
- New task ids are time-sortable UUIDs (version 7) instead of random version 4 UUIDs. Ids stay UUIDs, as `docs/openapi.yaml` declares (`format: uuid`); clients must treat them as opaque.
- The table is keyed by `ownerId` (partition) and `id` (sort) and has no secondary index. It is named `Tasks-<stage>`, and the IAM policy no longer grants access to index resources.
- Hardening ([spec 0010](specs/0010-harden-production-resources.md)): outside `dev` (every stage name other than `dev`) the task table and the user pool are retained when the stack is removed, protected against deletion, the table has point-in-time recovery, users may turn on authenticator-app MFA, and the app client no longer allows `USER_PASSWORD_AUTH` (SRP and refresh stay). Every route is throttled (429 above the limit), and each function has its own role limited to the one DynamoDB action it uses. The smoke test signs in through the admin flow in every stage.
- Log groups now keep logs for 7 days in `dev` and 90 days in other stages (they never expired before), and unknown errors are logged as JSON through the Powertools logger instead of plain text.
- `docs/openapi.yaml` `info.version` is `1.2.0`, and its description links the stability policy and states that pagination tokens are opaque and not valid across deployments (this was `1.0.0` at the releases `1.0.0` and `1.1.0`).

### Deprecated

- `PUT /tasks/{id}`, in favor of `PATCH /tasks/{id}`. It keeps working unchanged; every response carries `Deprecation: @1790985600`, `Sunset: Sat, 03 Apr 2027 00:00:00 GMT` and a `Link` header with `rel="deprecation"`. It may be removed after the sunset date, in a release announced in this changelog ([spec 0012](specs/0012-add-patch-task-route.md)). To migrate, change the verb to `PATCH`.

### Removed

- The table `TaskTable-<stage>` and the index `ownerId-createdAt-index`. See Upgrade notes.

### Upgrade notes

- **The old table and its data are deleted by the deploy.** Deploying this release replaces `TaskTable-<stage>` with `Tasks-<stage>`; tasks stored in the old table are lost. The project provides no copy script. Copy the data first if it matters; a stage that needs the data preserved is a new spec ([spec 0006](specs/0006-redesign-task-table-keys.md)).
- **A `nextToken` issued before the deploy is rejected with `400`.** Clients restart the listing from the first page when a stored token is rejected. Tokens are opaque and were never promised to survive a deployment.
- **New ids are version 7 UUIDs.** Existing clients that treat ids as opaque UUIDs need no change.
- Deploy the API stack and its table replacement together; there is no separate deployment of either.
- **Protected stages.** Any stage other than `dev` is now protected: `serverless remove` fails there until it is redeployed with `--param="deletionPolicy=Delete" --param="tableProtection=false" --param="userPoolProtection=INACTIVE"`, and a retained table keeps its name after a teardown. A client that signs in with `USER_PASSWORD_AUTH` outside `dev` must switch to SRP. Applying this to an existing stage updates its resources in place (no replacement).
- The deploy creates an SNS topic and three alarms. To receive alarm emails, deploy with `--param="alarmEmail=<address>"` and confirm the subscription email; without the parameter no email subscription is created.

## [1.1.0] - 2026-10-03

Compatibility class: no API change. This release delivers the spec-driven process, the first architecture step and repository documentation.

### Added

- The spec-driven workflow: `specs/`, the roadmap ([spec 0000](specs/0000-roadmap-to-layered-architecture.md)), `AGENTS.md` and links from the contributor documents.

### Changed

- Task persistence moved behind a `TaskRepository` port implemented by `DynamoTaskRepository`; handlers use the port ([spec 0001](specs/0001-extract-task-repository-port.md)). Behavior is unchanged.
- The shared agent rules live in `AGENTS.md`, and `CLAUDE.md` is kept local ([spec 0002](specs/0002-keep-claude-md-local.md)).

## [1.0.0] - 2026-10-03

First release. Compatibility class: initial contract.

### Added

- CRUD for tasks on an API Gateway HTTP API with one Lambda function per route: `POST /tasks`, `GET /tasks`, `GET /tasks/{id}`, `PUT /tasks/{id}` (a partial update) and `DELETE /tasks/{id}`, plus a public `GET /`.
- Amazon Cognito authentication with a JWT authorizer; every task belongs to its creator, and another user's task answers `404`.
- Cursor pagination for `GET /tasks` (`limit` from 1 to 100, opaque `nextToken`).
- Request validation with JSON Schema and the error body `{ "message": "..." }` with a list of failing fields in `errors`.
- The OpenAPI description (`docs/openapi.yaml`), a post-deploy smoke test, a contributing guide, the MIT license and CI for lint and tests on the four long-lived branches.

[Unreleased]: https://github.com/Stilpz/aws-lambda-crud-nodejs/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Stilpz/aws-lambda-crud-nodejs/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Stilpz/aws-lambda-crud-nodejs/releases/tag/v1.0.0

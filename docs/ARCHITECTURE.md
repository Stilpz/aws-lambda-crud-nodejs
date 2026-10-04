# Architecture

This document describes how the Tasks API is built today, why it is built that way, what a review of it found, and the roadmap to a layered architecture. For setup and usage see the [README](../README.md); for the API contract see [`openapi.yaml`](openapi.yaml).

## 1. Context

A small multi-user task service. Each user signs in with Amazon Cognito and manages only their own tasks. It is deliberately simple: one bounded context, one table, five functions. The goal of this document is to keep it simple while making it easy to evolve safely.

## 2. Current architecture

```
                      ┌────────────────────────── AWS account, one stack per stage ──────────────────────────┐
                      │                                                                                       │
Client ──HTTPS + JWT──┼─▶ API Gateway (HTTP API) ──▶ JWT authorizer ──▶ Lambda (one function per route) ──▶ DynamoDB
                      │                                    │                                                  │
                      │                                    └── validates the token against the Cognito user pool
                      └───────────────────────────────────────────────────────────────────────────────────────┘
```

| Concern | Choice |
| --- | --- |
| Compute | One Node.js 24 (`arm64`, ES modules) Lambda per route |
| API | API Gateway HTTP API with a Cognito JWT authorizer on every route except `GET /` |
| Identity | Cognito user pool `tasks-<stage>` and an app client without a secret |
| Data | DynamoDB `Tasks-<stage>`, on-demand billing, partition key `ownerId`, sort key `id` (a time-sortable UUID version 7), no secondary index |
| Request handling | middy: JSON body parser, Ajv JSON Schema validation, error-to-HTTP mapping |
| Infrastructure as code | Serverless Framework v4, a single `serverless.yml` |
| Delivery | CI runs lint and unit tests on the four long-lived branches; deploys are manual |

### Request lifecycle

1. API Gateway validates the JWT (issuer, audience, expiry). Failure ends the request with `401`; no function runs.
2. The route's Lambda receives the event with the verified claims in `requestContext.authorizer.jwt.claims`.
3. `getOwnerId` (`src/handlers/auth.js`) reads `sub`. This is the only source of identity.
4. For routes with a body, the middy stack parses it (`415` and `422` on failure) and validates it against a schema (`400`).
5. The handler calls the use case for the operation (wired in `src/container.js`), passing the caller as `ownerId`. The use case works through the task repository; `DynamoTaskRepository` is the only code that talks to DynamoDB, through the shared document client (`src/infrastructure/dynamoClient.js`).
6. The handler returns `{ statusCode, body }`. Errors thrown below it are turned into HTTP responses in one place, `withErrorMapping` (`src/handlers/errorBoundary.js`): not found is `404`, invalid pagination input is `400`, and anything else is logged and answered with `500` and a fixed message.

### Access patterns and ownership

All of these live in `DynamoTaskRepository` (`src/infrastructure/dynamoTaskRepository.js`), behind the `TaskRepository` port documented in `src/domain/taskRepository.js`. Handlers do not build DynamoDB requests.

| Operation | DynamoDB call | How ownership is enforced |
| --- | --- | --- |
| Create | `PutItem` with `attribute_not_exists(id)` | `ownerId` is set from the token |
| List | `Query` on the table with a consistent read | The partition key is the caller's `ownerId`; the cursor holds only the id and its owner is rebuilt from the token |
| Get | `GetItem` with `ConsistentRead` | The key includes the caller's `ownerId`, so another user's task is never addressed; absent means `404` |
| Update | `UpdateItem` | The key includes `ownerId`; condition `attribute_exists(id)`; failure is `404` |
| Delete | `DeleteItem` | Same key and condition as update |

## 3. Decision log

| Decision | Reason | Trade-off |
| --- | --- | --- |
| One Lambda per route | Independent deploys, scaling and least-privilege per function; simple mental model | Some duplication of bootstrapping; more functions to observe |
| HTTP API instead of REST API | Cheaper and lower latency, native JWT authorizer | No usage plans or API keys, no request validation at the gateway |
| Cognito JWT authorizer at the gateway | Authentication is not application code; invalid calls never cost a function invocation | Coupled to Cognito's token format |
| Ownership as the partition key | Ownership is the shape of every request, so it cannot be forgotten; listing is a consistent query; no index to maintain | Changing the key schema replaces the table (done once, in spec 0006) |
| `404` for other users' tasks | Does not reveal which ids exist | Slightly harder to debug a wrong token |
| Conditional writes for update and delete | Atomic ownership check, no read-then-write race | Condition failures need mapping to `404` |
| ESM + AWS SDK v3 | Required by middy 7; smaller, modular SDK | Node 22+ needed |
| Validation with JSON Schema (Ajv) | One declarative source per body, used by `POST` and `PUT` | Messages come from Ajv, not hand-written |
| Stage-per-stack naming (`-<stage>`) | Stages share an account without touching each other's data or users | Resources are replaced if the naming changes |

## 4. Review findings

Found while auditing the code against the documentation. Status is as of this document.

| # | Finding | Status |
| --- | --- | --- |
| F1 | `package.json` had no name, license or Node engine | Fixed |
| F2 | The listing read a GSI and was eventually consistent, undocumented | Fixed: the table is keyed by owner and id and listing is a consistent query ([spec 0006](../specs/0006-redesign-task-table-keys.md)) |
| F3 | No machine-readable API contract | Fixed (`openapi.yaml`) |
| F4 | No contributor guide for forks | Fixed (`CONTRIBUTING.md`) |
| F5 | README lacked consumer guidance, error model, troubleshooting and security notes | Fixed |
| F6 | Tasks created before `ownerId` are unreachable | Fixed: the key redesign makes an ownerless item impossible and replaces the old table ([spec 0006](../specs/0006-redesign-task-table-keys.md)); the interim cleanup script of [spec 0005](../specs/0005-migrate-orphan-task-owners.md) was retired |
| F7 | No end-to-end check of authentication and isolation | Fixed (`scripts/smoke.sh`); to be run in CI by step 8 |
| F8 | `GET /tasks/{id}` used an eventually consistent read, so a task could be missing right after it was created | Fixed (`ConsistentRead`) |
| F9 | Handlers combine HTTP, rules and persistence; ownership scoping depends on each handler remembering it | Fixed: persistence and ownership conditions are behind the repository port ([spec 0001](../specs/0001-extract-task-repository-port.md)) and every use case requires `ownerId` ([spec 0003](../specs/0003-add-task-use-cases.md)). Error mapping now sits in one boundary ([spec 0004](../specs/0004-standardize-error-responses.md)) |
| F10 | No observability, deploy pipeline, production safeguards (retention, point-in-time recovery, deletion protection) or CORS | Open; roadmap steps 6 to 9 |
| F11 | `PUT` has PATCH semantics; `POST` is not idempotent | Open; roadmap step 11 |

## 5. Target architecture

A layered "ports and adapters" structure inside the same Lambda-per-route deployment. Nothing changes for API consumers.

```
HTTP adapter (handlers + middy)  ──▶  Application (use cases)  ──▶  Domain (Task, rules, errors)
                                                │
                                                ▼  port: TaskRepository
                                    Infrastructure (DynamoTaskRepository, config, logger)
```

| Layer | Responsibility | Knows about |
| --- | --- | --- |
| `src/handlers/` | Parse and validate the request, read the caller from the JWT, call a use case, map the result or a typed error to HTTP | Application |
| `src/application/` | One function per use case (`createTask`, `listTasks`, `getTask`, `updateTask`, `deleteTask`). Each takes `ownerId` as a required argument, so scoping cannot be forgotten | Domain and the repository port |
| `src/domain/` | The `Task` shape, invariants, typed errors (`TaskNotFoundError`, `InvalidCursorError`) | Nothing else |
| `src/infrastructure/` | `DynamoTaskRepository` (the only code that knows keys, conditions and cursors), validated configuration, logger | AWS SDK |

Rules: dependencies point inward; handlers never import the AWS SDK; use cases never import middy or API Gateway types; the repository is the only place that knows the table design.

Testing follows the layers: use cases run against an in-memory repository (fast, no SDK mocks), the repository against DynamoDB Local, and handlers only prove HTTP mapping.

Scope boundary: this stays a single service. Splitting into services, a message bus or CQRS is not justified by the current size.

## 6. Roadmap

The roadmap is governed by [spec 0000](../specs/0000-roadmap-to-layered-architecture.md); this table is a summary. Every step is delivered under its own approved spec in [`specs/`](../specs/README.md), which fixes its scope, acceptance criteria and commit plan, and a change that is not in its spec is drift. Each step is its own branch, started from `development`, with its own pull request to `development` and small atomic commits.

| Step | Branch | Outcome | How it is verified |
| --- | --- | --- | --- |
| 1 | `extract-task-repository-port` | `TaskRepository` port and `DynamoTaskRepository`; handlers use it; behavior unchanged. **Done**, [spec 0001](../specs/0001-extract-task-repository-port.md) | Existing tests green; repository tests |
| 2 | `add-task-use-cases` | `application/` use cases take `ownerId`; handlers become thin and move to `src/handlers/`. **Done**, [spec 0003](../specs/0003-add-task-use-cases.md) | Use-case tests with an in-memory repository |
| 3 | `standardize-error-responses` | Typed errors and one error mapper; the `{ message }` shape is kept. **Done**, [spec 0004](../specs/0004-standardize-error-responses.md) | OpenAPI examples match responses |
| 4 | `migrate-orphan-task-owners` | Script that assigns `ownerId` to tasks created before ownership, or deletes them. Built in [spec 0005](../specs/0005-migrate-orphan-task-owners.md), then **retired** by step 5, which makes the problem impossible | Dry run on the dev table |
| 5 | `redesign-task-table-keys` | New table `Tasks-<stage>` keyed `ownerId` and `id` (UUID version 7): consistent listing, no GSI, ownership implicit in the key. The old table is replaced, not migrated. **Done**, [spec 0006](../specs/0006-redesign-task-table-keys.md) | Smoke test. Breaking for cursors and for the old table's data |
| 6 | `add-observability-with-powertools` | Structured logs, correlation id, tracing, metrics, log retention, alarms on 5xx, throttles and latency | Logs and alarms visible in dev |
| 7 | `add-ci-quality-gates` | OpenAPI lint, coverage threshold, dependency audit, template validation, DynamoDB Local integration job | CI green on a pull request |
| 8 | `add-deploy-pipeline-oidc` | Deploy from GitHub Actions through an AWS OIDC role (no long-lived keys): `development` to dev, `staging` to staging, `production` to prod with manual approval; run `scripts/smoke.sh` after each deploy | Deploy to dev from CI |
| 9 | `harden-production-resources` | `DeletionPolicy: Retain`, point-in-time recovery, deletion protection, explicit CORS origins, route throttling, per-function IAM, MFA option, SRP or hosted UI with PKCE instead of `USER_PASSWORD_AUTH` outside dev | Template validation; deploy to staging |
| 10 | `split-serverless-config-files` | `serverless.yml` split into `resources/` and `functions/` files | `serverless print` output unchanged |
| 11 | `add-patch-task-route` | `PATCH /tasks/{id}` for partial updates; `PUT` kept and marked deprecated | OpenAPI and tests |
| 11b | `add-post-idempotency-key` | Optional idempotency key on `POST`, stored in its own table with a time to live (its spec is still to be written) | Retried `POST` creates one task |
| 12 | `evaluate-typescript-migration` | Decision record: JSDoc types checked with `tsc` (no TypeScript migration) and Serverless v4 kept, with SAM as the fallback. **Done**, [spec 0016](../specs/0016-evaluate-typescript-migration.md), [record](decisions/0001-typing-and-deployment-framework.md) | Decision record in `docs/decisions/` |

Suggested order, as amended in [spec 0000](../specs/0000-roadmap-to-layered-architecture.md): steps 1 to 5 are done. For the rest, first the work that touches no deployed infrastructure (step 7 and the decision records), then the config split (step 10), observability (step 6) and hardening (step 9), in that order because all three edit the same file, then the deployment pipeline (step 8), and finally CORS, the PATCH route, the typed client and the SPA client.

## 7. Open decisions

- Keep the `{ message }` error shape, or adopt RFC 9457 problem details. Kept for now ([spec 0004](../specs/0004-standardize-error-responses.md)); changing it is a breaking change under the [versioning policy](API_VERSIONING.md).
- Resolved: what counts as a breaking change, how changes are deprecated, and how `info.version`, the git tags and the changelog relate are defined in [`API_VERSIONING.md`](API_VERSIONING.md) ([spec 0017](../specs/0017-define-api-versioning-policy.md)).
- Resolved: Serverless Framework v4 stays, with SAM as the documented fallback, and the code stays JavaScript with JSDoc types checked by `tsc`; forks without a Serverless account still cannot deploy as is ([decision record](decisions/0001-typing-and-deployment-framework.md), [spec 0016](../specs/0016-evaluate-typescript-migration.md)).
- Resolved: the listing no longer uses a GSI; it moved to the key redesign ([spec 0006](../specs/0006-redesign-task-table-keys.md)).

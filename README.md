# AWS Lambda CRUD API (Node.js)

A serverless REST API for managing tasks, built with Node.js on AWS Lambda, API Gateway (HTTP API), DynamoDB and Amazon Cognito, and deployed with the [Serverless Framework](https://www.serverless.com/framework). Every user signs in with Cognito and only sees their own tasks.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Configuration for Forks](#configuration-for-forks)
- [Authentication](#authentication)
- [API Reference](#api-reference)
- [Consuming the API](#consuming-the-api)
- [Error Model](#error-model)
- [Consistency Notes](#consistency-notes)
- [Data Model](#data-model)
- [Local Development](#local-development)
- [Testing and Linting](#testing-and-linting)
- [Deployment and Cleanup](#deployment-and-cleanup)
- [Known Limitations](#known-limitations)
- [Security Notes](#security-notes)
- [Troubleshooting](#troubleshooting)
- [Branching and Release Workflow](#branching-and-release-workflow)
- [Contributing](#contributing)
- [License](#license)

## Overview

This project exposes a small CRUD API over a single DynamoDB table, `TaskTable-<stage>`. Each endpoint is an independent Lambda function, so functions can be changed, deployed and scaled separately. The table uses on-demand billing (`PAY_PER_REQUEST`), so an idle deployment costs practically nothing.

Requests are authenticated with a JWT issued by an Amazon Cognito user pool. Each task stores the id of the user who created it, and every endpoint only reads or changes that user's tasks.

## Documentation

| Document | What it is for |
| --- | --- |
| This README | Setup, authentication, API reference, consuming the API, troubleshooting |
| [`docs/openapi.yaml`](docs/openapi.yaml) | Machine-readable API contract (OpenAPI 3.0.3). Import it into Postman, Insomnia or a client generator |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Current design, decisions, review findings and the roadmap to a layered architecture |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to contribute from a fork, step by step |
| [`specs/`](specs/README.md) | Spec-driven change process: every modification has an approved spec that acts as its contract, plus the roadmap |
| [`CLAUDE.md`](CLAUDE.md) and [`AGENTS.md`](AGENTS.md) | Working rules for agents and contributors: workflow, architecture rules, engineering standards, definition of done |
| [`scripts/smoke.sh`](scripts/smoke.sh) | Post-deploy check of authentication and per-user isolation |

## Architecture

```
Client ──HTTP + JWT──▶ API Gateway (HTTP API) ──▶ Lambda function ──▶ DynamoDB (TaskTable-<stage>)
                              │
                              └── JWT authorizer validates the token against the Cognito user pool
```

| Component | Detail |
| --- | --- |
| Runtime | Node.js 24 (`nodejs24.x`), `arm64`, ES modules |
| Region | `us-west-2` |
| Framework | Serverless Framework v4 |
| Database | DynamoDB, partition key `id` (string), on-demand billing, plus a global secondary index on `ownerId` and `createdAt` |
| Authentication | Amazon Cognito user pool and app client, JWT authorizer on the HTTP API |
| Request handling | [middy](https://middy.js.org/): JSON body parsing, JSON Schema validation (Ajv) and error handling |
| SDK | AWS SDK for JavaScript v3 (`@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`), document client |

The DynamoDB table, the Cognito user pool and app client, the authorizer and the IAM permissions the functions need are declared in `serverless.yml`, so a single deploy creates everything. The IAM role is limited to `PutItem`, `GetItem`, `Query`, `UpdateItem` and `DeleteItem` on the table and its indexes.

## Project Structure

```
.
├── serverless.yml      # Functions, HTTP routes, authorizer, IAM role, DynamoDB table and Cognito resources
├── package.json        # Dependencies and the test and lint scripts
├── LICENSE             # MIT license
├── CONTRIBUTING.md     # Contribution guide for forks
├── CLAUDE.md           # Working rules for agents and contributors
├── AGENTS.md           # Pointer to CLAUDE.md for other agents
├── specs/              # Change contracts: process, template, roadmap and one spec per change
├── docs/
│   ├── openapi.yaml    # API contract (OpenAPI 3.0.3)
│   └── ARCHITECTURE.md # Design, findings and roadmap
├── scripts/
│   └── smoke.sh        # Post-deploy authentication and isolation check
├── .github/            # CI workflow and pull request template
├── src/
│   ├── hello.js        # GET    /             health-check style greeting (public)
│   ├── addTask.js      # POST   /tasks        create a task
│   ├── getTasks.js     # GET    /tasks        list the caller's tasks
│   ├── getTask.js      # GET    /tasks/{id}   fetch one task
│   ├── updateTask.js   # PUT    /tasks/{id}   partially update a task
│   ├── deleteTask.js   # DELETE /tasks/{id}   delete a task
│   ├── auth.js         # Reads the caller's user id from the JWT claims
│   ├── middleware.js   # Shared middy stack: JSON body, validation and error responses
│   ├── schemas.js      # JSON Schemas for the create and update bodies
│   ├── pagination.js   # limit parsing for GET /tasks; nextToken is passed on as an opaque cursor
│   ├── domain/         # Task type, domain errors and the TaskRepository port (imports nothing else)
│   └── infrastructure/ # DynamoTaskRepository, the DynamoDB client and the composition root
└── tests/              # Vitest unit tests; DynamoDB is mocked, nothing reaches AWS
```

## Prerequisites

- [Node.js](https://nodejs.org/) 22 or newer (the deployed runtime is Node.js 24)
- npm
- The Serverless Framework v4 CLI: `npm install -g serverless`
- An AWS account and credentials configured locally (for example with `aws configure`), allowed to create Lambda, API Gateway, IAM, DynamoDB and Cognito resources
- A Serverless Framework account (v4 requires logging in with `serverless login`, or setting a `SERVERLESS_ACCESS_KEY`)
- The [AWS CLI](https://aws.amazon.com/cli/), used below to create users and get tokens

## Getting Started

```bash
git clone <your-fork-or-repo-url>
cd aws-lambda-crud-nodejs
npm install
```

Before your first deploy, review [Configuration for Forks](#configuration-for-forks), then:

```bash
serverless deploy
```

The output lists the base URL of your API, similar to `https://xxxxxxxxxx.execute-api.us-west-2.amazonaws.com`. The examples below use it as `$API_URL`. Then [create a user and get a token](#authentication) before calling the task endpoints.

## Configuration for Forks

`serverless.yml` contains values tied to the original author's accounts. **Change these before deploying your fork**, or the deploy will fail or target the wrong account:

| Setting | Where | What to do |
| --- | --- | --- |
| `org` | top of `serverless.yml` | Replace with your own Serverless Framework org, or remove the line if you do not use one. |
| `service` | `serverless.yml` | Optional. Rename it to change the CloudFormation stack and resource names. |
| `provider.region` | `serverless.yml` | Change if you want another AWS region. |

The table, the user pool and their ARNs are built from the stage and the stack, so nothing else is tied to an account. Handlers read the table name from the `TABLE_NAME` environment variable that `serverless.yml` sets.

## Authentication

Every endpoint except `GET /` requires a valid JWT in the `Authorization` header:

```
Authorization: Bearer <token>
```

Requests without a token, or with an invalid or expired one, are rejected by API Gateway with `401 Unauthorized` before any function runs.

The deploy exports two values as CloudFormation stack outputs: `UserPoolId` and `UserPoolClientId`. The pool signs users in with their email, requires passwords of at least 8 characters with lowercase, uppercase and a number, and the app client allows the `USER_PASSWORD_AUTH`, `USER_SRP_AUTH` and refresh token flows.

The steps below use the AWS CLI. Replace the stack name if your stage is not `dev`, and use your own email and password.

**1. Read the deployed values**

```bash
REGION=us-west-2
STACK=aws-lambda-crud-nodejs-dev

CLIENT_ID=$(aws cloudformation describe-stacks --stack-name $STACK --region $REGION \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" --output text)
USER_POOL_ID=$(aws cloudformation describe-stacks --stack-name $STACK --region $REGION \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)
```

**2. Create a user** (an admin-created user skips the email confirmation step, which is convenient for testing)

```bash
aws cognito-idp admin-create-user --region $REGION --user-pool-id "$USER_POOL_ID" \
  --username "ana@example.com" --message-action SUPPRESS \
  --user-attributes Name=email,Value=ana@example.com Name=email_verified,Value=true

aws cognito-idp admin-set-user-password --region $REGION --user-pool-id "$USER_POOL_ID" \
  --username "ana@example.com" --password "Example1234" --permanent
```

**3. Get a token**

```bash
TOKEN=$(aws cognito-idp initiate-auth --region $REGION --auth-flow USER_PASSWORD_AUTH \
  --client-id "$CLIENT_ID" \
  --auth-parameters "USERNAME=ana@example.com,PASSWORD=Example1234" \
  --query AuthenticationResult.IdToken --output text)
```

**4. Call the API**

```bash
curl -H "Authorization: Bearer $TOKEN" $API_URL/tasks
```

Tokens expire after one hour by default. Repeat step 3 to get a new one. Keep the `$TOKEN` variable in the same terminal session where you run the `curl` examples below.

## API Reference

All request and response bodies are JSON. Error responses have the shape `{ "message": "..." }`. Except for `GET /`, every endpoint needs the `Authorization` header described in [Authentication](#authentication), and answers `401` when it is missing or invalid. A task can only be read, changed or deleted by the user who created it: asking for another user's task returns `404 Task not found`, the same answer as for a task that does not exist.

### `GET /`

Public. Returns a greeting. Useful to verify the deployment.

```bash
curl $API_URL/
# {"message":"Hello, World!"}
```

### `POST /tasks`: create a task

Requests must use `Content-Type: application/json`.

| Field | Validation |
| --- | --- |
| `title` | Required. Non-empty string. |
| `description` | Optional string. Defaults to an empty string. |

The server generates `id` (UUID v4) and `createdAt`, sets `ownerId` to the authenticated user and sets `done` to `false`.

```bash
curl -X POST $API_URL/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Write docs","description":"Add a README"}'
```

```json
{
  "id": "0b9f5c1e-6c2a-4f0e-9d0b-2f1f3f0a7a11",
  "ownerId": "b1c2d3e4-5f60-4a7b-8c9d-0e1f2a3b4c5d",
  "title": "Write docs",
  "description": "Add a README",
  "createdAt": "2026-09-29T15:04:05.000Z",
  "done": false
}
```

| Status | Meaning |
| --- | --- |
| 201 | The created task |
| 400 | The body failed validation. The response lists the failing fields in `errors` |
| 401 | Missing, invalid or expired token |
| 415 | `Content-Type` is not `application/json` |
| 422 | The body is not valid JSON |
| 500 | `Could not create task` |

### `GET /tasks`: list tasks

Returns one page of the caller's tasks, oldest first. Use `nextToken` to fetch the following page.

| Query parameter | Description |
| --- | --- |
| `limit` | Optional. Page size, an integer from 1 to 100. Defaults to 50. |
| `nextToken` | Optional. The `nextToken` returned by the previous page. |

```bash
curl -H "Authorization: Bearer $TOKEN" "$API_URL/tasks?limit=10"
curl -H "Authorization: Bearer $TOKEN" "$API_URL/tasks?limit=10&nextToken=<token from the previous response>"
```

```json
{
  "items": [{ "id": "0b9f5c1e-6c2a-4f0e-9d0b-2f1f3f0a7a11", "ownerId": "b1c2d3e4-5f60-4a7b-8c9d-0e1f2a3b4c5d", "title": "Write docs", "description": "Add a README", "createdAt": "2026-09-29T15:04:05.000Z", "done": false }],
  "nextToken": "eyJpZCI6IjBiOWY1YzFlLTZjMmEtNGYwZS05ZDBiLTJmMWYzZjBhN2ExMSIsImNyZWF0ZWRBdCI6IjIwMjYtMDktMjlUMTU6MDQ6MDUuMDAwWiJ9"
}
```

`nextToken` is `null` when there are no more pages. Keep requesting pages until it is `null`: a page can be empty while a token is still returned, for example when the last page ends exactly at `limit`. Tokens are opaque, so pass them back unchanged. A token only works for the user it was issued to.

| Status | Meaning |
| --- | --- |
| 200 | `{ items, nextToken }` |
| 400 | `limit` is not an integer from 1 to 100, or `nextToken` is invalid |
| 401 | Missing, invalid or expired token |
| 500 | `Could not retrieve tasks` |

### `GET /tasks/{id}`: get one task

```bash
curl -H "Authorization: Bearer $TOKEN" $API_URL/tasks/0b9f5c1e-6c2a-4f0e-9d0b-2f1f3f0a7a11
```

| Status | Meaning |
| --- | --- |
| 200 | The task |
| 401 | Missing, invalid or expired token |
| 404 | `Task not found`, or the task belongs to another user |
| 500 | `Could not retrieve task` |

### `PUT /tasks/{id}`: update a task

Requests must use `Content-Type: application/json`. Partial update: send any combination of the following fields, and only the fields you send are changed. At least one is required, and other fields are ignored.

| Field | Validation |
| --- | --- |
| `done` | boolean |
| `title` | non-empty string |
| `description` | string |

```bash
curl -X PUT $API_URL/tasks/0b9f5c1e-6c2a-4f0e-9d0b-2f1f3f0a7a11 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"done":true}'
```

| Status | Meaning |
| --- | --- |
| 200 | `Task updated successfully` |
| 400 | No updatable field was sent, or a field has an invalid value. The response lists the failing fields in `errors` |
| 401 | Missing, invalid or expired token |
| 404 | `Task not found`, or the task belongs to another user |
| 415 | `Content-Type` is not `application/json` |
| 422 | The body is not valid JSON |
| 500 | `Could not update task` |

### `DELETE /tasks/{id}`: delete a task

```bash
curl -X DELETE -H "Authorization: Bearer $TOKEN" $API_URL/tasks/0b9f5c1e-6c2a-4f0e-9d0b-2f1f3f0a7a11
```

| Status | Meaning |
| --- | --- |
| 200 | `Task deleted successfully` |
| 401 | Missing, invalid or expired token |
| 404 | `Task not found`, or the task belongs to another user |
| 500 | `Could not delete task` |

## Consuming the API

### The typical flow

1. The user signs in with Cognito (with an SDK such as AWS Amplify or `amazon-cognito-identity-js`, or with the AWS CLI while testing) and gets an ID token, an access token and a refresh token.
2. The client sends the ID token in `Authorization: Bearer <token>` with every request.
3. When a request returns `401`, the token has most likely expired (one hour by default). The client exchanges the refresh token for a new one and retries once.
4. If the refresh also fails, the user must sign in again.

### Refreshing a token

Keep the whole authentication result when you sign in, not only the ID token:

```bash
AUTH=$(aws cognito-idp initiate-auth --region $REGION --auth-flow USER_PASSWORD_AUTH \
  --client-id "$CLIENT_ID" \
  --auth-parameters "USERNAME=ana@example.com,PASSWORD=Example1234" \
  --query AuthenticationResult --output json)
```

Later, trade the refresh token (valid for 30 days by default) for a fresh ID token:

```bash
REFRESH_TOKEN=$(echo "$AUTH" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).RefreshToken)')

TOKEN=$(aws cognito-idp initiate-auth --region $REGION --auth-flow REFRESH_TOKEN_AUTH \
  --client-id "$CLIENT_ID" --auth-parameters "REFRESH_TOKEN=$REFRESH_TOKEN" \
  --query AuthenticationResult.IdToken --output text)
```

### JavaScript client

A small client for Node.js 22+ or a browser, with error handling and an async iterator that follows the pagination for you:

```js
const API_URL = process.env.API_URL; // for example https://xxxxxxxxxx.execute-api.us-west-2.amazonaws.com

async function api(path, { token, ...init } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    // 401: expired or invalid token. 400: body.errors lists the failing fields.
    throw Object.assign(new Error(body?.message ?? response.statusText), {
      status: response.status,
      body,
    });
  }

  return body;
}

// Yields every task of the signed-in user, one page at a time.
async function* listTasks(token, limit = 50) {
  let nextToken = null;

  do {
    const query = new URLSearchParams({ limit: String(limit), ...(nextToken && { nextToken }) });
    const page = await api(`/tasks?${query}`, { token });

    yield* page.items;
    nextToken = page.nextToken;
  } while (nextToken);
}

const task = await api("/tasks", {
  token,
  method: "POST",
  body: JSON.stringify({ title: "Write docs", description: "Add a README" }),
});

await api(`/tasks/${task.id}`, { token, method: "PUT", body: JSON.stringify({ done: true }) });

for await (const item of listTasks(token)) {
  console.log(item.title, item.done);
}

await api(`/tasks/${task.id}`, { token, method: "DELETE" });
```

### Client rules of thumb

- Send `Content-Type: application/json` on `POST` and `PUT`; otherwise the API answers `415`.
- Treat `nextToken` as an opaque string: store it, send it back unchanged, and stop only when it is `null`.
- Do not parse tokens or task ids; do not assume ids are sortable.
- Do not retry `4xx` responses other than a single retry after refreshing a `401`. `5xx` responses are safe to retry for `GET` and `DELETE`; a retried `POST` can create a duplicate task because the API has no idempotency key.
- The contract in [`docs/openapi.yaml`](docs/openapi.yaml) can generate typed clients, for example with `npx @openapitools/openapi-generator-cli`.

## Error Model

Errors from the functions have the shape `{ "message": "..." }`. Validation errors (`400` on `POST` and `PUT`) add the failing fields:

```json
{
  "message": "Event object failed validation",
  "errors": ["/body must have required property 'title'"]
}
```

| Status | Raised by | Typical cause |
| --- | --- | --- |
| 400 | Function | Failed body validation, or an invalid `limit` or `nextToken` |
| 401 | API Gateway | Missing, invalid or expired token. The function never runs |
| 404 | Function | The task does not exist, or belongs to another user |
| 415 | Function | `Content-Type` is not `application/json` |
| 422 | Function | The body is not valid JSON |
| 500 | Function | An unexpected failure, such as a DynamoDB error. Details go to the function logs, not to the response |
| 429 | API Gateway | Throttled by the default API Gateway limits. Retry with a delay |

## Consistency Notes

- `GET /tasks/{id}` uses a consistent read, so a task is readable immediately after it is created or updated.
- `GET /tasks` reads a global secondary index, which is **eventually consistent**. A task created a moment ago can be missing from the list for a short time (usually well under a second). If your client lists right after a create, add the new task to its local list instead of re-reading, or retry.
- Updates and deletes are conditional writes and are always evaluated against the latest data.

## Data Model

Items in `TaskTable-<stage>`:

| Attribute | Type | Notes |
| --- | --- | --- |
| `id` | String | Partition key. UUID v4 generated on creation. |
| `ownerId` | String | The `sub` claim of the user's JWT. Set on creation and never changed. |
| `title` | String | |
| `description` | String | |
| `createdAt` | String | ISO 8601 timestamp. |
| `done` | Boolean | `false` on creation. |

The global secondary index `ownerId-createdAt-index` (partition key `ownerId`, sort key `createdAt`, all attributes projected) serves `GET /tasks`, so listing reads only the caller's tasks instead of scanning the table.

## Local Development

The Serverless Framework can emulate Lambda locally while tunnelling requests to and from AWS:

```bash
serverless dev
```

You can also invoke a single function once, passing a sample event. Outside API Gateway there is no authorizer, so the event must carry the claims it would have added:

```bash
serverless invoke local --function getTask \
  --data '{"pathParameters":{"id":"some-id"},"requestContext":{"authorizer":{"jwt":{"claims":{"sub":"user-1"}}}}}'
```

Local invocations still talk to the real table, so it must be deployed first and your AWS credentials must have access to it.

To add an endpoint:

1. Create a handler in `src/`, exporting an async function that returns `{ statusCode, body }`. For a handler that reads a JSON body, wrap it with `withJsonBody` from `src/middleware.js` and a schema from `src/schemas.js`.
2. Register it under `functions` in `serverless.yml` with its `httpApi` path and method, and the `cognitoAuthorizer` authorizer unless the route is meant to be public.
3. Scope its data with `getOwnerId` from `src/auth.js`.
4. Add tests, then deploy and try it.

## Testing and Linting

```bash
npm test        # Vitest unit tests; DynamoDB is mocked
npm run lint    # ESLint
```

CI runs both on every push and pull request for the four long-lived branches.

The unit tests mock DynamoDB, so they cannot prove that the authorizer, the ownership checks and the index work together. After a deploy, run the smoke test, which creates two throwaway users, checks authentication and isolation end to end, and deletes what it created:

```bash
STAGE=dev REGION=us-west-2 ./scripts/smoke.sh
```

It needs the AWS CLI with credentials, `curl` and `node`.

## Deployment and Cleanup

```bash
serverless deploy                      # deploy everything to the default stage (dev)
serverless deploy --stage staging      # deploy to another stage (staging, prod)
serverless deploy function -f getTask  # quickly redeploy one function's code
serverless logs -f getTask --tail      # stream a function's logs
serverless remove                      # delete the whole stack
```

`serverless remove` also deletes the task table, the Cognito user pool, and with them every task and user.

Each stage has its own table, named `TaskTable-<stage>`, and its own user pool, named `tasks-<stage>`, so stages can share an AWS account and region without touching each other's data or users.

The first deploy that adds `ownerId-createdAt-index` to an existing table builds the index in the background. Tasks created before ownership was introduced have no `ownerId`, so they do not appear in listings and answer `404`. Delete or migrate them.

## Known Limitations

This is a learning-oriented project, so it leaves out several things a production service would need:

- **Users are managed outside the API.** There is no sign-up, password reset or token refresh endpoint. Create users with the AWS CLI or the Cognito console, and use Cognito's own APIs for the rest.
- **No CORS configuration.** Browsers on another origin cannot call the API yet. Add `@middy/http-cors` or an `httpApi.cors` setting when a frontend needs it.
- **Tasks from before ownership have no owner** and are unreachable until deleted or migrated. See [Deployment and Cleanup](#deployment-and-cleanup).
- **`POST /tasks` is not idempotent.** A retried request can create a duplicate task; there is no idempotency key.
- **`PUT /tasks/{id}` is a partial update** (PATCH semantics) kept for compatibility.
- **No rate limiting or throttling beyond the API Gateway defaults**, and no custom domain.
- **Local invocation needs hand-written authorizer claims** and still uses the deployed table.

## Security Notes

- **Identity comes from the verified token, never from the request.** `ownerId` is the `sub` claim that API Gateway has already validated, and no endpoint accepts an owner from the body, path or query. A forged `nextToken` cannot reach another user's tasks either: the owner part of the cursor is rebuilt from the token.
- **Another user's task is a `404`, not a `403`**, so the API does not reveal which task ids exist.
- **Tokens are credentials.** Do not log them, paste them in issues or commit them. An ID token also carries the user's email.
- **`USER_PASSWORD_AUTH` is convenient for testing and scripts**, but it sends the password to Cognito from your code. For real applications prefer the SRP flow of a Cognito SDK, or the hosted UI with PKCE.
- **`admin-create-user` and `admin-set-user-password` skip email verification.** Use them for tests only.
- **Everything is HTTPS.** API Gateway does not serve plain HTTP.
- **The Lambda role is least-privilege**: five DynamoDB actions on one table and its indexes, nothing else.
- **Each stage has its own user pool**, so a token from `dev` is rejected by `prod`.
- Report a vulnerability privately to the maintainer instead of opening a public issue.

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| `401 Unauthorized` with a token | The token expired (one hour), or it comes from another stage's user pool. Get a new one. Check that the header is exactly `Authorization: Bearer <token>` |
| `401` on every call, including a fresh token | `$TOKEN` is empty because the sign-in command failed. Run `echo "$TOKEN"` and check the command's error |
| `bash: UserPoolClientId: No such file or directory` | A `<placeholder>` was pasted literally. In the shell `<` is a redirection: replace the whole `<...>` with the real value |
| `UserNotFoundException` | The user does not exist in this stage's pool. Create it ([Authentication](#authentication)), or check `STACK` and `REGION` |
| `NotAuthorizedException: Incorrect username or password` | Wrong credentials, or the password was never set with `--permanent` |
| `UserNotConfirmedException` | The user signed up but did not confirm the email. Confirm it, or recreate it with `admin-create-user` |
| `400` with an `errors` list | The body failed validation. Read each entry, for example `/body must have required property 'title'` |
| `415 Unsupported Media Type` | Add `-H "Content-Type: application/json"` to `POST` and `PUT` |
| `422 Invalid or malformed JSON` | The body is not valid JSON. In a Windows shell, quote the JSON with single quotes, or write it to a file and use `-d @file.json` |
| `404 Task not found` on your own task | You are using another user's token, or the task was created before ownership was introduced and has no `ownerId` |
| Empty list right after a create | `GET /tasks` is eventually consistent. Retry after a moment, or use `GET /tasks/{id}` |
| `500` | Read the logs: `serverless logs -f <function> --tail` (functions: `createTask`, `getTasks`, `getTask`, `updateTask`, `deleteTask`) |
| `serverless deploy` asks you to log in | Serverless v4 needs `serverless login` or `SERVERLESS_ACCESS_KEY`, and a valid `org` in `serverless.yml` |
| The deploy fails on the first run in a fork | Review [Configuration for Forks](#configuration-for-forks); the `org` value belongs to the original author |

## Branching and Release Workflow

Four long-lived branches carry a change from review to release:

| Branch | Purpose | Stage | Deploy command |
| --- | --- | --- | --- |
| `development` | Integration. Every pull request targets this branch. | `dev` | `serverless deploy --stage dev` |
| `staging` | Pre-release validation. | `staging` | `serverless deploy --stage staging` |
| `production` | Released code. This is what runs in production. | `prod` | `serverless deploy --stage prod` |
| `main` | Archive of released code. Never committed to directly. | none | not deployed |

```
feature branch ──PR──▶ development ──PR──▶ staging ──PR──▶ production ──PR──▶ main
                          (dev)            (staging)         (prod)         (archive)
```

- Work branches start from `development`. Names are lowercase, use hyphens between words, have 3 to 5 words, contain no spaces, accents or special characters, and do not end with a hyphen, for example `add-task-pagination`.
- Promote a change by opening a pull request from one branch to the next one. Use a merge commit rather than squash, so the branches keep the same history and do not diverge.
- After a release is live in `production`, open a pull request from `production` to `main`. `main` only receives code that has already been released, so it stays unaltered.
- For an urgent fix, branch from `production`, open a pull request back to `production`, and then merge the fix into `staging` and `development` so it is not lost in the next promotion.
- CI (lint and tests) runs on pushes and pull requests for all four branches. Deployments are manual.

Recommended repository settings: make `development` the default branch so new pull requests target it, and protect all four branches by requiring a pull request, passing CI and disallowing force pushes and deletion.

## Contributing

Contributions are welcome. The full, step-by-step guide for working from a fork is in [`CONTRIBUTING.md`](CONTRIBUTING.md). In short:

1. Fork the repository, add the original as `upstream`, and create a branch from an up-to-date `development`, following the naming rules above: `git checkout -b add-my-change`.
2. Get an approved spec in `specs/` for the change (see [`specs/README.md`](specs/README.md)), make your change inside its scope, keeping the style of the surrounding code, and update `docs/openapi.yaml` and this README if the API changes.
3. Run `npm run lint` and `npm test`, and add tests for new behavior.
4. Deploy to your own AWS account on a personal stage and run `scripts/smoke.sh`.
5. Keep commits small and focused, with a descriptive title and a message explaining what changed and why.
6. Open a pull request against `development` describing the change and how you tested it.

Never commit AWS credentials, access keys, tokens or `.env` files. `node_modules` and `.serverless` are already git-ignored.

## License

Released under the [MIT License](LICENSE).

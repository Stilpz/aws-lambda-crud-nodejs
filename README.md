# AWS Lambda CRUD API (Node.js)

A serverless REST API for managing tasks, built with Node.js on AWS Lambda, API Gateway (HTTP API) and DynamoDB, and deployed with the [Serverless Framework](https://www.serverless.com/framework).

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Configuration for Forks](#configuration-for-forks)
- [API Reference](#api-reference)
- [Data Model](#data-model)
- [Local Development](#local-development)
- [Deployment and Cleanup](#deployment-and-cleanup)
- [Known Limitations](#known-limitations)
- [Branching and Release Workflow](#branching-and-release-workflow)
- [Contributing](#contributing)

## Overview

This project exposes a small CRUD API over a single `TaskTable` DynamoDB table. Each endpoint is an independent Lambda function, so functions can be changed, deployed and scaled separately. The table uses on-demand billing (`PAY_PER_REQUEST`), so an idle deployment costs practically nothing.

## Architecture

```
Client ──HTTP──▶ API Gateway (HTTP API) ──▶ Lambda function ──▶ DynamoDB (TaskTable)
```

| Component | Detail |
| --- | --- |
| Runtime | Node.js 24 (`nodejs24.x`), `arm64` |
| Region | `us-west-2` |
| Framework | Serverless Framework v4 |
| Database | DynamoDB, partition key `id` (string), on-demand billing |
| SDK | AWS SDK for JavaScript v3 (`@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`), document client |

The DynamoDB table and the IAM permissions the functions need are declared in `serverless.yml`, so a single deploy creates everything.

## Project Structure

```
.
├── serverless.yml      # Functions, HTTP routes, IAM role and DynamoDB table
├── package.json        # Dependencies (AWS SDK v3 clients)
└── src/
    ├── hello.js        # GET    /             health-check style greeting
    ├── addTask.js      # POST   /tasks        create a task
    ├── getTasks.js     # GET    /tasks        list the caller's tasks
    ├── getTask.js      # GET    /tasks/{id}   fetch one task
    ├── updateTask.js   # PUT    /tasks/{id}   partially update a task
    └── deleteTask.js   # DELETE /tasks/{id}   delete a task
```

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or newer (the deployed runtime is Node.js 24)
- npm
- The Serverless Framework v4 CLI: `npm install -g serverless`
- An AWS account and credentials configured locally (for example with `aws configure`), allowed to create Lambda, API Gateway, IAM and DynamoDB resources
- A Serverless Framework account (v4 requires logging in with `serverless login`, or setting a `SERVERLESS_ACCESS_KEY`)

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

The output lists the base URL of your API, similar to `https://xxxxxxxxxx.execute-api.us-west-2.amazonaws.com`. The examples below use it as `$API_URL`.

## Configuration for Forks

`serverless.yml` contains values tied to the original author's accounts. **Change these before deploying your fork**, or the deploy will fail or target the wrong account:

| Setting | Where | What to do |
| --- | --- | --- |
| `org` | top of `serverless.yml` | Replace with your own Serverless Framework org, or remove the line if you do not use one. |
| `service` | `serverless.yml` | Optional. Rename it to change the CloudFormation stack and resource names. |
| `provider.region` | `serverless.yml` | Change if you want another AWS region. |
| IAM `Resource` ARN | `provider.iam.role.statements` | Contains a hard-coded region and AWS account ID. Replace it with your own, or build it dynamically. |

The table name `TaskTable` is hard-coded in `serverless.yml` and in every handler. If you rename it, update all of them together.

## API Reference

All request and response bodies are JSON. Error responses have the shape `{ "message": "..." }`.

### `GET /`

Returns a greeting. Useful to verify the deployment.

```bash
curl $API_URL/
# {"message":"Hello, World!"}
```

### `POST /tasks`: create a task

Body: `title` and `description`. The server generates `id` (UUID v4) and `createdAt`, and sets `done` to `false`.

```bash
curl -X POST $API_URL/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Write docs","description":"Add a README"}'
```

```json
{
  "id": "0b9f5c1e-6c2a-4f0e-9d0b-2f1f3f0a7a11",
  "title": "Write docs",
  "description": "Add a README",
  "createdAt": "2026-09-29T15:04:05.000Z",
  "done": false
}
```

### `GET /tasks`: list tasks

Returns one page of tasks. Use `nextToken` to fetch the following page.

| Query parameter | Description |
| --- | --- |
| `limit` | Optional. Page size, an integer from 1 to 100. Defaults to 50. |
| `nextToken` | Optional. The `nextToken` returned by the previous page. |

```bash
curl "$API_URL/tasks?limit=10"
curl "$API_URL/tasks?limit=10&nextToken=<token from the previous response>"
```

```json
{
  "items": [{ "id": "0b9f5c1e-6c2a-4f0e-9d0b-2f1f3f0a7a11", "title": "Write docs", "description": "Add a README", "createdAt": "2026-09-29T15:04:05.000Z", "done": false }],
  "nextToken": "eyJpZCI6IjBiOWY1YzFlLTZjMmEtNGYwZS05ZDBiLTJmMWYzZjBhN2ExMSJ9"
}
```

`nextToken` is `null` when there are no more pages. Keep requesting pages until it is `null`: a page can be empty while a token is still returned, for example when the last page ends exactly at `limit`. Tokens are opaque, so pass them back unchanged.

| Status | Meaning |
| --- | --- |
| 200 | `{ items, nextToken }` |
| 400 | `limit` is not an integer from 1 to 100, or `nextToken` is invalid |
| 500 | `Could not retrieve tasks` |

### `GET /tasks/{id}`: get one task

```bash
curl $API_URL/tasks/0b9f5c1e-6c2a-4f0e-9d0b-2f1f3f0a7a11
```

| Status | Meaning |
| --- | --- |
| 200 | The task |
| 404 | `Task not found` |
| 500 | `Could not retrieve task` |

### `PUT /tasks/{id}`: update a task

Partial update. Send any combination of the following fields; only the fields you send are changed.

| Field | Validation |
| --- | --- |
| `done` | boolean |
| `title` | non-empty string |
| `description` | string |

```bash
curl -X PUT $API_URL/tasks/0b9f5c1e-6c2a-4f0e-9d0b-2f1f3f0a7a11 \
  -H "Content-Type: application/json" \
  -d '{"done":true}'
```

| Status | Meaning |
| --- | --- |
| 200 | `Task updated successfully` |
| 400 | Body is not valid JSON, no updatable field was sent, or a field has an invalid value |
| 404 | `Task not found` |
| 500 | `Could not update task` |

### `DELETE /tasks/{id}`: delete a task

```bash
curl -X DELETE $API_URL/tasks/0b9f5c1e-6c2a-4f0e-9d0b-2f1f3f0a7a11
```

| Status | Meaning |
| --- | --- |
| 200 | `Task deleted successfully` |
| 404 | `Task not found` |
| 500 | `Could not delete task` |

## Data Model

Items in `TaskTable`:

| Attribute | Type | Notes |
| --- | --- | --- |
| `id` | String | Partition key. UUID v4 generated on creation. |
| `title` | String | |
| `description` | String | |
| `createdAt` | String | ISO 8601 timestamp. |
| `done` | Boolean | `false` on creation. |

## Local Development

The Serverless Framework can emulate Lambda locally while tunnelling requests to and from AWS:

```bash
serverless dev
```

You can also invoke a single function once, passing a sample event:

```bash
serverless invoke local --function getTask \
  --data '{"pathParameters":{"id":"some-id"}}'
```

Local invocations still talk to the real `TaskTable`, so the table must be deployed first and your AWS credentials must have access to it.

To add an endpoint:

1. Create a handler in `src/`, exporting an async function that returns `{ statusCode, body }`.
2. Register it under `functions` in `serverless.yml` with its `httpApi` path and method.
3. Deploy and test it.

## Deployment and Cleanup

```bash
serverless deploy                      # deploy everything to the default stage (dev)
serverless deploy --stage staging      # deploy to another stage (staging, prod)
serverless deploy function -f getTask  # quickly redeploy one function's code
serverless logs -f getTask --tail      # stream a function's logs
serverless remove                      # delete the whole stack
```

`serverless remove` also deletes `TaskTable` and every task in it.

Each stage has its own table, named `TaskTable-<stage>`, so stages can share an AWS account and region without touching each other's data.

## Known Limitations

This is a learning-oriented project and is not production-ready as is:

- **No authentication.** The API is public; anyone with the URL can read and change data. Add an [authorizer](https://www.serverless.com/framework/docs/providers/aws/events/http-api) before real use.
- **`POST /tasks` does not validate its input** and returns `200` instead of `201`. Invalid JSON will make the function fail.
- **The IAM policy grants `dynamodb:*`** on the table; narrowing it to the actions actually used (`PutItem`, `GetItem`, `Query`, `UpdateItem`, `DeleteItem`) is recommended.
- **No automated tests or linting** are configured yet.
- **No license file.** Add one before accepting outside contributions or redistributing.

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

Contributions are welcome.

1. Fork the repository and create a branch from `development`, following the naming rules above: `git checkout -b add-my-change`.
2. Make your change, keeping the style of the surrounding code.
3. Deploy to your own AWS account and verify the affected endpoints manually.
4. Keep commits small and focused, with a descriptive title and a message explaining what changed and why.
5. Open a pull request against `development` describing the change and how you tested it.

Never commit AWS credentials, access keys or `.env` files. `node_modules` and `.serverless` are already git-ignored.

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
| SDK | AWS SDK for JavaScript v2 (`aws-sdk`), `DocumentClient` |

The DynamoDB table and the IAM permissions the functions need are declared in `serverless.yml`, so a single deploy creates everything.

## Project Structure

```
.
├── serverless.yml      # Functions, HTTP routes, IAM role and DynamoDB table
├── package.json        # Dependencies (aws-sdk)
└── src/
    ├── hello.js        # GET    /             health-check style greeting
    ├── addTask.js      # POST   /tasks        create a task
    ├── getTasks.js     # GET    /tasks        list all tasks
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

Returns an array with all tasks.

```bash
curl $API_URL/tasks
```

| Status | Meaning |
| --- | --- |
| 200 | Array of tasks |
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
serverless deploy --stage prod         # deploy to another stage
serverless deploy function -f getTask  # quickly redeploy one function's code
serverless logs -f getTask --tail      # stream a function's logs
serverless remove                      # delete the whole stack
```

`serverless remove` also deletes `TaskTable` and every task in it.

Note that the table is named `TaskTable` regardless of the stage, so two stages deployed to the same account and region would conflict. Deploy each stage to a separate account or region, or make the table name stage-dependent first.

## Known Limitations

This is a learning-oriented project and is not production-ready as is:

- **No authentication.** The API is public; anyone with the URL can read and change data. Add an [authorizer](https://www.serverless.com/framework/docs/providers/aws/events/http-api) before real use.
- **`POST /tasks` does not validate its input** and returns `200` instead of `201`. Invalid JSON will make the function fail.
- **`GET /tasks` uses a table `Scan` without pagination**, so it only returns the first page (up to 1 MB) of results.
- **The IAM policy grants `dynamodb:*`** on the table; narrowing it to the actions actually used (`PutItem`, `GetItem`, `Scan`, `UpdateItem`, `DeleteItem`) is recommended.
- **No automated tests or linting** are configured yet.
- **No license file.** Add one before accepting outside contributions or redistributing.

## Contributing

Contributions are welcome.

1. Fork the repository and create a branch from `main`: `git checkout -b feature/my-change`.
2. Make your change, keeping the style of the surrounding code.
3. Deploy to your own AWS account and verify the affected endpoints manually.
4. Keep commits small and focused, with a descriptive title and a message explaining what changed and why.
5. Open a pull request describing the change and how you tested it.

Never commit AWS credentials, access keys or `.env` files. `node_modules` and `.serverless` are already git-ignored.

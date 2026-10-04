# Contributing

Thanks for helping improve this project. This guide covers the whole path of a contribution made from a fork: setting up, making a change, checking it and getting it merged.

## Ground rules

- **Every change needs a spec.** Before writing code, a spec in [`specs/`](specs/README.md) describes the scope and acceptance criteria and is approved by the maintainer. Implement exactly what it says; new ideas become a new spec. Typo and documentation-only fixes are exempt. [`AGENTS.md`](AGENTS.md) holds the full working rules.
- Every pull request targets `development`, never `main`, `staging` or `production`. See [Branching and Release Workflow](README.md#branching-and-release-workflow).
- Work branches start from `development`. Names are lowercase, use hyphens, have 3 to 5 words, contain no spaces, accents or special characters, and do not end with a hyphen, for example `add-task-pagination`.
- One logical change per branch and per commit. Unrelated fixes go in separate pull requests.
- Never commit AWS credentials, access keys, tokens or `.env` files.

## 1. Fork and set up

```bash
# Fork the repository on GitHub first, then:
git clone git@github.com:<your-user>/aws-lambda-crud-nodejs.git
cd aws-lambda-crud-nodejs
git remote add upstream git@github.com:Stilpz/aws-lambda-crud-nodejs.git
git fetch upstream
git checkout -b development upstream/development   # a local development that tracks upstream
npm install
```

You need Node.js 22 or newer and npm. To deploy you also need the Serverless Framework v4 CLI, the AWS CLI and credentials (see [Prerequisites](README.md#prerequisites)).

## 2. Create a branch

Always branch from an up-to-date `development`:

```bash
git checkout development
git pull upstream development
git checkout -b add-my-change
```

If your change depends on another open pull request, say so in your description and wait for it to merge, then rebase on `development`.

## 3. Make the change

- Start from the approved spec (or propose one in a pull request that adds only the spec) and stay inside its scope.
- Keep the style of the file you edit (ES modules, and the indentation and quotes already used there; `npm run lint` enforces the rest).
- Handlers read the caller with `getOwnerId` in `src/handlers/auth.js` and pass it to a use case; the table name comes from `process.env.TABLE_NAME` in the composition root (`src/container.js`). Every use case and repository call takes the caller as `ownerId`, and every query, update and delete must be scoped to it. See [Local Development](README.md#local-development) for how to add an endpoint.
- If you add or change a route, status code or field, update [`docs/openapi.yaml`](docs/openapi.yaml) and the API tables in the README in the same pull request.

## 4. Check it

```bash
npm run lint
npm run test:coverage                     # must stay above the thresholds in vitest.config.js
npm run lint:api                          # when you touched the API contract
npm run audit:prod                        # when you touched dependencies
```

Add tests for new behavior. DynamoDB is mocked in `tests/helpers.js` (`mockDynamo`), so tests never reach AWS. If you touched the repository, also run the integration tests against DynamoDB Local: `DYNAMODB_ENDPOINT=http://localhost:8000 npm run test:integration` (start it with `docker run -p 8000:8000 amazon/dynamodb-local:3.3.1`).

Then check it against a real deployment in your **own** AWS account, using a personal stage so you do not collide with anyone:

```bash
serverless deploy --stage <your-name>
STAGE=<your-name> ./scripts/smoke.sh   # authentication and isolation checks
serverless remove --stage <your-name>  # clean up when you are done
```

`serverless remove` deletes the stage's table and user pool with everything in them.

## 5. Commit

Small, focused commits in English. Each message has a descriptive title, a `What:` paragraph and a `Why:` paragraph:

```
Reject blank titles on update

What: updateTask now validates title with the same non-empty pattern as createTask.

Why: A blank title could be saved through PUT even though POST refuses it.
```

Explain the motivation in `Why`, not a restatement of the diff.

## 6. Keep your fork in sync

```bash
git fetch upstream
git checkout development
git merge --ff-only upstream/development
git checkout add-my-change
git rebase development
```

## 7. Open the pull request

Push your branch to your fork and open a pull request against `Stilpz/aws-lambda-crud-nodejs:development`. The template asks for the governing spec, what changed, why, how you tested it and a checklist. CI (lint, coverage, OpenAPI lint, dependency audit, template validation and integration tests) must be green. Maintainers merge with a merge commit, not squash, so the branches keep the same history.

## Reporting problems

Open an issue with what you did, what you expected, what happened and the status code or error message. Never paste tokens or account ids. If you found a security problem, do not open a public issue: contact the maintainer privately through the email on their GitHub profile.

## License

By contributing you agree that your contribution is released under the [MIT License](LICENSE).

import { parseArgs } from "node:util";

const DEFAULT_REGION = "us-west-2";
// A Cognito user's "sub" is a UUID; anything else is almost certainly a typo.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class UsageError extends Error {}

export const USAGE = `Usage: node scripts/migrate-orphan-task-owners.js <target> <action> [--apply]

Finds the tasks that have no ownerId and either gives them an owner or deletes them.
It is a dry run unless --apply is given.

Target (exactly one):
  --stage <name>     the table TaskTable-<name>
  --table <name>     an explicit table name
  --region <region>  AWS region (default: AWS_REGION, then ${DEFAULT_REGION})

Action (exactly one):
  --owner <sub>      assign this owner (a Cognito user's sub, a UUID)
  --delete           delete the tasks without an owner

  --apply            perform the changes (without it nothing is written)
  --help             show this message
`;

export const parseCliArguments = (argv, env = {}) => {
    let values;

    try {
        ({ values } = parseArgs({
            args: argv,
            strict: true,
            options: {
                stage: { type: "string" },
                table: { type: "string" },
                region: { type: "string" },
                owner: { type: "string" },
                delete: { type: "boolean" },
                apply: { type: "boolean" },
                help: { type: "boolean" },
            },
        }));
    } catch (error) {
        throw new UsageError(error.message);
    }

    if (values.help) {
        return { help: true };
    }

    if (Boolean(values.stage) === Boolean(values.table)) {
        throw new UsageError("Give exactly one of --stage or --table");
    }

    if (Boolean(values.owner) === Boolean(values.delete)) {
        throw new UsageError("Give exactly one of --owner or --delete");
    }

    if (values.owner && !UUID.test(values.owner)) {
        throw new UsageError("--owner must be a UUID (the sub of a Cognito user)");
    }

    return {
        help: false,
        tableName: values.table ?? `TaskTable-${values.stage}`,
        region: values.region ?? env.AWS_REGION ?? DEFAULT_REGION,
        action: values.delete ? { type: "delete" } : { type: "assign", ownerId: values.owner },
        apply: Boolean(values.apply),
    };
};

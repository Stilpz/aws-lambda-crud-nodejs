import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { migrateOrphanTasks, parseCliArguments, USAGE, UsageError } from "./orphanTaskOwners.js";

// Thin entry point: all the logic, and all the safety rules, live in orphanTaskOwners.js where
// they are tested. This file only wires the real AWS client and the console.
const main = async () => {
    let options;

    try {
        options = parseCliArguments(process.argv.slice(2), process.env);
    } catch (error) {
        if (error instanceof UsageError) {
            console.error(`${error.message}\n\n${USAGE}`);
            return 2;
        }

        throw error;
    }

    if (options.help) {
        console.log(USAGE);
        return 0;
    }

    const { tableName, region, action, apply } = options;

    console.log(`Table: ${tableName} (${region})`);
    console.log(action.type === "delete" ? "Action: delete tasks without an owner" : `Action: assign owner ${action.ownerId}`);
    console.log(apply ? "Mode: APPLY, changes will be written" : "Mode: dry run, nothing will be written (add --apply to perform it)");

    const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
    const summary = await migrateOrphanTasks({ client, tableName, action, apply, log: console.log });

    console.log(`Found ${summary.found}, changed ${summary.changed}, skipped ${summary.skipped}, failed ${summary.failed}`);

    return summary.failed > 0 ? 1 : 0;
};

try {
    process.exitCode = await main();
} catch (error) {
    console.error(`Migration stopped: ${error.message}`);
    process.exitCode = 1;
}

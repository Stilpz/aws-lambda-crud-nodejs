import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoDb } from "./db.js";
import { getOwnerId } from "./auth.js";

const getTask = async (event) => {
    const { id } = event.pathParameters;

    try {
        const result = await dynamoDb.send(new GetCommand({
            TableName: process.env.TABLE_NAME,
            Key: { id },
            ConsistentRead: true,
        }));

        // A task owned by someone else is reported as missing so its existence is not revealed.
        if (!result.Item || result.Item.ownerId !== getOwnerId(event)) {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: "Task not found" }),
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify(result.Item),
        };
    } catch (error) {
        console.error("Error retrieving task:", error);

        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Could not retrieve task" }),
        };
    }
}

export {
    getTask,
}
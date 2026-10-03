import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoDb } from "./db.js";
import { getOwnerId } from "./auth.js";

const deleteTask = async (event) => {
    const { id } = event.pathParameters;

    try {
        await dynamoDb.send(new DeleteCommand({
            TableName: process.env.TABLE_NAME,
            Key: { id },
            ConditionExpression: "attribute_exists(id) AND ownerId = :ownerId",
            ExpressionAttributeValues: { ":ownerId": getOwnerId(event) },
        }));

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Task deleted successfully" }),
        };
    } catch (error) {
        if (error.name === "ConditionalCheckFailedException") {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: "Task not found" }),
            };
        }

        console.error("Error deleting task:", error);

        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Could not delete task" }),
        };
    }
}

export { deleteTask };
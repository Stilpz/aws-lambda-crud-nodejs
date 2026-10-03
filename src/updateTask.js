import { withJsonBody } from "./middleware.js";
import { updateTaskSchema } from "./schemas.js";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoDb } from "./db.js";
import { getOwnerId } from "./auth.js";

const UPDATABLE_FIELDS = ['done', 'title', 'description'];

const updateTaskHandler = async (event) => {
    const { id } = event.pathParameters;

    const body = event.body;

    const fields = UPDATABLE_FIELDS.filter((key) => body[key] !== undefined);

    const updateExpression = 'set ' + fields.map((key) => `#${key} = :${key}`).join(', ');
    const expressionAttributeNames = Object.fromEntries(fields.map((key) => [`#${key}`, key]));
    const expressionAttributeValues = {
        ...Object.fromEntries(fields.map((key) => [`:${key}`, body[key]])),
        ':ownerId': getOwnerId(event),
    };

    try {
        await dynamoDb.send(new UpdateCommand({
            TableName: process.env.TABLE_NAME,
            Key: { id },
            UpdateExpression: updateExpression,
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues,
            ConditionExpression: 'attribute_exists(id) AND ownerId = :ownerId',
            ReturnValues: 'ALL_NEW',
        }));

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Task updated successfully' }),
        };
    } catch (error) {
        if (error.name === 'ConditionalCheckFailedException') {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: 'Task not found' }),
            };
        }

        console.error('Error updating task:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Could not update task' }),
        };
    }
};

export const updateTask = withJsonBody(updateTaskHandler, updateTaskSchema);

import { dynamoDb } from "./db.js";
import { getOwnerId } from "./auth.js";
import { encodeNextToken, InvalidPaginationError, parsePagination } from "./pagination.js";

const getTasks = async (event) => {
    try {
        const ownerId = getOwnerId(event);
        const { limit, exclusiveStartKey } = parsePagination(event.queryStringParameters, ownerId);

        const result = await dynamoDb.query({
            TableName: process.env.TABLE_NAME,
            IndexName: "ownerId-createdAt-index",
            KeyConditionExpression: "ownerId = :ownerId",
            ExpressionAttributeValues: { ":ownerId": ownerId },
            Limit: limit,
            ExclusiveStartKey: exclusiveStartKey,
        }).promise();

        return {
            statusCode: 200,
            body: JSON.stringify({
                items: result.Items,
                nextToken: encodeNextToken(result.LastEvaluatedKey),
            }),
        };
    } catch (error) {
        if (error instanceof InvalidPaginationError) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: error.message }),
            };
        }

        console.error("Error retrieving tasks:", error);

        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Could not retrieve tasks" }),
        };
    }
}

export {
    getTasks,
}

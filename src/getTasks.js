import { dynamoDb } from "./db.js";
import { encodeNextToken, InvalidPaginationError, parsePagination } from "./pagination.js";

const getTasks = async (event) => {
    try {
        const { limit, exclusiveStartKey } = parsePagination(event.queryStringParameters);

        const result = await dynamoDb.scan({
            TableName: process.env.TABLE_NAME,
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

const AWS = require("aws-sdk");

const getTask = async (event) => {
    const dynamoDb = new AWS.DynamoDB.DocumentClient();
    const { id } = event.pathParameters;

    try {
        const result = await dynamoDb.get({
            TableName: "TaskTable",
            Key: { id },
        }).promise();

        if (!result.Item) {
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

module.exports = {
    getTask,
}
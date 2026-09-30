import AWS from "aws-sdk";

const deleteTask = async (event) => {
    const { id } = event.pathParameters;

    const dynamoDb = new AWS.DynamoDB.DocumentClient();

    try {
        await dynamoDb.delete({
            TableName: "TaskTable",
            Key: { id },
            ConditionExpression: "attribute_exists(id)",
        }).promise();

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Task deleted successfully" }),
        };
    } catch (error) {
        if (error.code === "ConditionalCheckFailedException") {
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
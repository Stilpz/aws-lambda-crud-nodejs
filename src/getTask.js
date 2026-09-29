const AWS = require("aws-sdk");

const getTask = async (event) => {
    const dynamoDb = new AWS.DynamoDB.DocumentClient();
    const { id } = event.pathParameters;

    const result = await dynamoDb.get({
        TableName: "TaskTable",
        Key: { id },
    }).promise();

    const task = result.Item;

    return {
        statusCode: 200,
        body: JSON.stringify(task),
    };
}

module.exports = {
    getTask,
}
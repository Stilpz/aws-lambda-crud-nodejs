const AWS = require('aws-sdk');

const updateTask = async (event) => {

    const dynamoDb = new AWS.DynamoDB.DocumentClient();
    const { id } = event.pathParameters;
    const { done } = JSON.parse(event.body);

    await dynamoDb.update({
        TableName: 'TaskTable',
        Key: {
            id,
        },
        UpdateExpression: 'set done = :done',
        ExpressionAttributeValues: {
            ":done": done,
        },
        ReturnValues: 'ALL_NEW',
    }).promise();

    return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Task updated successfully' }),
    };
}


module.exports = {
    updateTask
}
const AWS = require("aws-sdk");

const getTasks = async (event) => {
    const dynamoDb = new AWS.DynamoDB.DocumentClient();

    const result= await dynamoDb.scan({
        TableName : 'TaskTable'
    }).promise();

    const tasks = result.Items;

    return {
        statusCode: 200,
        body: JSON.stringify(tasks),
    };
}

module.exports = {
    getTasks,
}
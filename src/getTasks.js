const AWS = require("aws-sdk");

const getTasks = async (event) => {
    try {
        const dynamoDb = new AWS.DynamoDB.DocumentClient();

        const result= await dynamoDb.scan({
            TableName : 'TaskTable'
        }).promise();

        const tasks = result.Items;

        return {
            statusCode: 200,
            body: JSON.stringify(tasks),
        };
    } catch (error) {
        console.error("Error retrieving tasks:", error);
    }
}

module.exports = {
    getTasks,
}
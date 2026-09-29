const { randomUUID } = require("crypto");
const AWS = require("aws-sdk");

const addTask = async (event) => {
    const dynamoDb = new AWS.DynamoDB.DocumentClient();

    const { title, description } = JSON.parse(event.body);
    const createdAt = new Date().toISOString();
    const id = randomUUID();

    const newTask =  {
        id,
        title,
        description,
        createdAt,
        done: false,
    };

    await dynamoDb.put({
        TableName: "TaskTable",
        Item: newTask,
    }).promise();

    return {
        statusCode: 200,
        body: JSON.stringify(newTask),
    };

};

module.exports = {
  addTask,
};

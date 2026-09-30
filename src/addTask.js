import { randomUUID } from "crypto";
import AWS from "aws-sdk";

import { withJsonBody } from "./middleware.js";
import { createTaskSchema } from "./schemas.js";

const addTaskHandler = async (event) => {
    const dynamoDb = new AWS.DynamoDB.DocumentClient();

    const { title, description = "" } = event.body;
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
        statusCode: 201,
        body: JSON.stringify(newTask),
    };

};

export const addTask = withJsonBody(addTaskHandler, createTaskSchema);

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

    try {
        await dynamoDb.put({
            TableName: "TaskTable",
            Item: newTask,
        }).promise();

        return {
            statusCode: 201,
            body: JSON.stringify(newTask),
        };
    } catch (error) {
        console.error("Error creating task:", error);

        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Could not create task" }),
        };
    }
};

export const addTask = withJsonBody(addTaskHandler, createTaskSchema);

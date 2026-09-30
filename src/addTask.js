import { randomUUID } from "crypto";

import { withJsonBody } from "./middleware.js";
import { createTaskSchema } from "./schemas.js";
import { dynamoDb } from "./db.js";

const addTaskHandler = async (event) => {
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
            TableName: process.env.TABLE_NAME,
            Item: newTask,
            ConditionExpression: "attribute_not_exists(id)",
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

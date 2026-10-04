import { randomUUID } from "crypto";

import { withJsonBody } from "./middleware.js";
import { createTaskSchema } from "./schemas.js";
import { getOwnerId } from "./auth.js";
import { taskRepository } from "./infrastructure/taskRepository.js";

const addTaskHandler = async (event) => {
    const { title, description = "" } = event.body;
    const createdAt = new Date().toISOString();
    const id = randomUUID();

    const newTask =  {
        id,
        ownerId: getOwnerId(event),
        title,
        description,
        createdAt,
        done: false,
    };

    try {
        await taskRepository.create(newTask);

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

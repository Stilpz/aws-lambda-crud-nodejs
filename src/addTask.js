import { withJsonBody } from "./middleware.js";
import { createTaskSchema } from "./schemas.js";
import { getOwnerId } from "./auth.js";
import { createTask } from "./container.js";

const addTaskHandler = async (event) => {
    const { title, description } = event.body;
    const ownerId = getOwnerId(event);

    try {
        const task = await createTask({ ownerId, title, description });

        return {
            statusCode: 201,
            body: JSON.stringify(task),
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

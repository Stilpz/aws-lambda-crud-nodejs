import { withJsonBody } from "./middleware.js";
import { withErrorMapping } from "./errorBoundary.js";
import { updateTaskSchema } from "./schemas.js";
import { getOwnerId } from "./auth.js";
import { updateTask as changeTask } from "../container.js";

const updateTaskHandler = async (event) => {
    const { id } = event.pathParameters;

    await changeTask({ ownerId: getOwnerId(event), id, changes: event.body });

    return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Task updated successfully' }),
    };
};

export const updateTask = withJsonBody(
    withErrorMapping(updateTaskHandler, { logLabel: "Error updating task:", failureMessage: "Could not update task" }),
    updateTaskSchema,
);

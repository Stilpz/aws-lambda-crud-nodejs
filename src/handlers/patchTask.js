import { withJsonBody } from "./middleware.js";
import { withErrorMapping } from "./errorBoundary.js";
import { updateTaskSchema } from "./schemas.js";
import { getOwnerId } from "./auth.js";
import { updateTask as changeTask } from "../container.js";

const patchTaskHandler = async (event) => {
    const { id } = event.pathParameters;

    const task = await changeTask({ ownerId: getOwnerId(event), id, changes: event.body });

    return {
        statusCode: 200,
        body: JSON.stringify(task),
    };
};

export const patchTask = withJsonBody(
    withErrorMapping(patchTaskHandler, { logLabel: "Error updating task:", failureMessage: "Could not update task" }),
    updateTaskSchema,
);

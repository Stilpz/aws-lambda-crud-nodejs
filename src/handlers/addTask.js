import { withJsonBody } from "./middleware.js";
import { withObservability } from "./withObservability.js";
import { withErrorMapping } from "./errorBoundary.js";
import { createTaskSchema } from "./schemas.js";
import { getOwnerId } from "./auth.js";
import { createTask } from "../container.js";

const addTaskHandler = async (event) => {
    const { title, description } = event.body;

    const task = await createTask({ ownerId: getOwnerId(event), title, description });

    return {
        statusCode: 201,
        body: JSON.stringify(task),
    };
};

export const addTask = withObservability(
    withJsonBody(
        withErrorMapping(addTaskHandler, { logLabel: "Error creating task:", failureMessage: "Could not create task" }),
        createTaskSchema,
    ),
);

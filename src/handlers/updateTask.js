import { withJsonBody } from "./middleware.js";
import { updateTaskSchema } from "./schemas.js";
import { getOwnerId } from "./auth.js";
import { updateTask as changeTask } from "../container.js";
import { TaskNotFoundError } from "../domain/errors.js";

const updateTaskHandler = async (event) => {
    const { id } = event.pathParameters;

    try {
        await changeTask({ ownerId: getOwnerId(event), id, changes: event.body });

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Task updated successfully' }),
        };
    } catch (error) {
        if (error instanceof TaskNotFoundError) {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: 'Task not found' }),
            };
        }

        console.error('Error updating task:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Could not update task' }),
        };
    }
};

export const updateTask = withJsonBody(updateTaskHandler, updateTaskSchema);

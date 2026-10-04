import { getOwnerId } from "./auth.js";
import { deleteTask as removeTask } from "./container.js";
import { TaskNotFoundError } from "./domain/errors.js";

const deleteTask = async (event) => {
    const { id } = event.pathParameters;

    try {
        await removeTask({ ownerId: getOwnerId(event), id });

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Task deleted successfully" }),
        };
    } catch (error) {
        if (error instanceof TaskNotFoundError) {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: "Task not found" }),
            };
        }

        console.error("Error deleting task:", error);

        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Could not delete task" }),
        };
    }
}

export { deleteTask };

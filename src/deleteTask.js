import { getOwnerId } from "./auth.js";
import { TaskNotFoundError } from "./domain/errors.js";
import { taskRepository } from "./infrastructure/taskRepository.js";

const deleteTask = async (event) => {
    const { id } = event.pathParameters;

    try {
        await taskRepository.delete(getOwnerId(event), id);

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

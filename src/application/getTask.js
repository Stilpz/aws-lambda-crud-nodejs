import { TaskNotFoundError } from "../domain/errors.js";

export const makeGetTask = ({ taskRepository }) =>
    async ({ ownerId, id }) => {
        const task = await taskRepository.findById(ownerId, id);

        if (!task) {
            throw new TaskNotFoundError();
        }

        return task;
    };

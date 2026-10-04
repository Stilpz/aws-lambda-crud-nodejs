// Time and id generation are injected so the use case is deterministic under test.
export const makeCreateTask = ({ taskRepository, generateId, now }) =>
    async ({ ownerId, title, description = "" }) => {
        const task = {
            id: generateId(),
            ownerId,
            title,
            description,
            createdAt: now().toISOString(),
            done: false,
        };

        await taskRepository.create(task);

        return task;
    };

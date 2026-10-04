import { InvalidCursorError, TaskNotFoundError } from "../src/domain/errors.js";
import { UPDATABLE_FIELDS } from "../src/domain/task.js";

// Test double for the TaskRepository port. It honors the behavior documented in
// src/domain/taskRepository.js, so use cases can be tested without any SDK stub.
export class InMemoryTaskRepository {
    #tasks = new Map();

    async create(task) {
        if (this.#tasks.has(task.id)) {
            throw new Error(`Task ${task.id} already exists`);
        }

        this.#tasks.set(task.id, { ...task });
    }

    async findById(ownerId, id) {
        const task = this.#tasks.get(id);

        return task?.ownerId === ownerId ? { ...task } : null;
    }

    async listByOwner(ownerId, { limit, cursor }) {
        const owned = [...this.#tasks.values()]
            .filter((task) => task.ownerId === ownerId)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

        const start = cursor === undefined ? 0 : this.#positionAfter(owned, cursor);
        const items = owned.slice(start, start + limit).map((task) => ({ ...task }));
        const hasMore = start + limit < owned.length;

        return { items, nextCursor: hasMore ? Buffer.from(items.at(-1).id).toString("base64url") : null };
    }

    async update(ownerId, id, changes) {
        const task = this.#owned(ownerId, id);

        for (const field of UPDATABLE_FIELDS) {
            if (changes[field] !== undefined) {
                task[field] = changes[field];
            }
        }
    }

    async delete(ownerId, id) {
        this.#owned(ownerId, id);
        this.#tasks.delete(id);
    }

    #owned(ownerId, id) {
        const task = this.#tasks.get(id);

        if (task?.ownerId !== ownerId) {
            throw new TaskNotFoundError();
        }

        return task;
    }

    #positionAfter(owned, cursor) {
        const lastId = Buffer.from(cursor, "base64url").toString();
        const index = owned.findIndex((task) => task.id === lastId);

        if (index === -1) {
            throw new InvalidCursorError();
        }

        return index + 1;
    }
}

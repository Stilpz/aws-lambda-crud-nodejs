/**
 * Port through which the application reads and writes tasks. Every implementation must honor
 * the behavior documented here.
 *
 * Every operation except `create` takes the owner, so a query that is not scoped to a user
 * cannot be written by accident. A task that belongs to someone else is indistinguishable from
 * a missing one.
 *
 * @typedef {Object} TaskRepository
 * @property {(task: import("./task.js").Task) => Promise<void>} create
 *   Stores a new task. Never overwrites an existing one.
 * @property {(ownerId: string, id: string) => Promise<import("./task.js").Task | null>} findById
 *   Resolves `null` when the task does not exist or belongs to another user.
 * @property {(ownerId: string, options: { limit: number, cursor?: string }) =>
 *   Promise<{ items: import("./task.js").Task[], nextCursor: string | null }>} listByOwner
 *   The owner's tasks, oldest first. `cursor` is opaque; one that cannot be decoded rejects with
 *   `InvalidCursorError`. `nextCursor` is `null` when there are no more pages.
 * @property {(ownerId: string, id: string, changes: Partial<import("./task.js").Task>) => Promise<import("./task.js").Task>} update
 *   Changes only the fields listed in `UPDATABLE_FIELDS` and resolves the task as it is after the
 *   change. Rejects with `TaskNotFoundError`.
 * @property {(ownerId: string, id: string) => Promise<void>} delete
 *   Rejects with `TaskNotFoundError`.
 *
 * Infrastructure failures propagate as the original error.
 */

export {};

/**
 * @typedef {Object} Task
 * @property {string} id
 * @property {string} ownerId The `sub` claim of the user who created the task.
 * @property {string} title
 * @property {string} description
 * @property {string} createdAt ISO 8601 timestamp.
 * @property {boolean} done
 */

// The only fields a task can change after creation.
export const UPDATABLE_FIELDS = ["done", "title", "description"];

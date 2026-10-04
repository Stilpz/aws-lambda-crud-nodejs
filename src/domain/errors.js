// A task that does not exist, or that belongs to another user. The two cases are deliberately
// indistinguishable so the existence of someone else's task is never revealed.
export class TaskNotFoundError extends Error {
    constructor() {
        super("Task not found");
        this.name = "TaskNotFoundError";
    }
}

export class InvalidCursorError extends Error {
    constructor() {
        super("nextToken is invalid");
        this.name = "InvalidCursorError";
    }
}

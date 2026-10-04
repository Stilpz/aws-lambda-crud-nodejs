import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeCreateTask } from "../../src/application/createTask.js";
import { makeDeleteTask } from "../../src/application/deleteTask.js";
import { makeGetTask } from "../../src/application/getTask.js";
import { makeListTasks } from "../../src/application/listTasks.js";
import { makeUpdateTask } from "../../src/application/updateTask.js";
import { InvalidCursorError, TaskNotFoundError } from "../../src/domain/errors.js";
import { InMemoryTaskRepository } from "../inMemoryTaskRepository.js";

const ALICE = "alice";
const BOB = "bob";

let taskRepository;
let ids;
let clock;
let createTask;

beforeEach(() => {
    taskRepository = new InMemoryTaskRepository();
    ids = 0;
    clock = Date.parse("2026-01-01T00:00:00.000Z");
    createTask = makeCreateTask({
        taskRepository,
        generateId: () => `task-${++ids}`,
        now: () => new Date((clock += 1000)),
    });
});

describe("createTask", () => {
    it("builds and stores a task owned by the caller", async () => {
        const task = await createTask({ ownerId: ALICE, title: "Write tests", description: "With Vitest" });

        expect(task).toEqual({
            id: "task-1",
            ownerId: ALICE,
            title: "Write tests",
            description: "With Vitest",
            createdAt: "2026-01-01T00:00:01.000Z",
            done: false,
        });
        expect(await taskRepository.findById(ALICE, "task-1")).toEqual(task);
    });

    it("defaults a missing description to an empty string", async () => {
        const task = await createTask({ ownerId: ALICE, title: "t" });

        expect(task.description).toBe("");
    });

    it("gives every task its own id and creation time", async () => {
        const first = await createTask({ ownerId: ALICE, title: "a" });
        const second = await createTask({ ownerId: ALICE, title: "b" });

        expect(second.id).not.toBe(first.id);
        expect(second.createdAt > first.createdAt).toBe(true);
    });

    it("propagates repository failures", async () => {
        vi.spyOn(taskRepository, "create").mockRejectedValue(new Error("boom"));

        await expect(createTask({ ownerId: ALICE, title: "t" })).rejects.toThrow("boom");
    });
});

describe("getTask", () => {
    let getTask;

    beforeEach(() => {
        getTask = makeGetTask({ taskRepository });
    });

    it("returns the caller's task", async () => {
        const created = await createTask({ ownerId: ALICE, title: "t" });

        expect(await getTask({ ownerId: ALICE, id: created.id })).toEqual(created);
    });

    it("throws TaskNotFoundError when the task does not exist", async () => {
        await expect(getTask({ ownerId: ALICE, id: "missing" })).rejects.toThrow(TaskNotFoundError);
    });

    it("throws TaskNotFoundError for another user's task", async () => {
        const created = await createTask({ ownerId: ALICE, title: "t" });

        await expect(getTask({ ownerId: BOB, id: created.id })).rejects.toThrow(TaskNotFoundError);
    });

    it("propagates repository failures", async () => {
        vi.spyOn(taskRepository, "findById").mockRejectedValue(new Error("boom"));

        await expect(getTask({ ownerId: ALICE, id: "x" })).rejects.toThrow("boom");
    });
});

describe("listTasks", () => {
    let listTasks;

    beforeEach(() => {
        listTasks = makeListTasks({ taskRepository });
    });

    it("lists only the caller's tasks, oldest first", async () => {
        const first = await createTask({ ownerId: ALICE, title: "first" });
        await createTask({ ownerId: BOB, title: "not alice's" });
        const second = await createTask({ ownerId: ALICE, title: "second" });

        const page = await listTasks({ ownerId: ALICE, limit: 50 });

        expect(page).toEqual({ items: [first, second], nextCursor: null });
    });

    it("returns an empty page when the caller has no tasks", async () => {
        expect(await listTasks({ ownerId: ALICE, limit: 50 })).toEqual({ items: [], nextCursor: null });
    });

    it("pages through the tasks with the cursor", async () => {
        const created = [];
        for (const title of ["a", "b", "c"]) {
            created.push(await createTask({ ownerId: ALICE, title }));
        }

        const firstPage = await listTasks({ ownerId: ALICE, limit: 2 });
        const secondPage = await listTasks({ ownerId: ALICE, limit: 2, cursor: firstPage.nextCursor });

        expect(firstPage.items).toEqual(created.slice(0, 2));
        expect(firstPage.nextCursor).toBeTypeOf("string");
        expect(secondPage).toEqual({ items: created.slice(2), nextCursor: null });
    });

    it("passes the owner, limit and cursor to the repository", async () => {
        const spy = vi.spyOn(taskRepository, "listByOwner");

        await listTasks({ ownerId: ALICE, limit: 7, cursor: undefined });

        expect(spy).toHaveBeenCalledWith(ALICE, { limit: 7, cursor: undefined });
    });

    it("lets InvalidCursorError propagate", async () => {
        await expect(listTasks({ ownerId: ALICE, limit: 5, cursor: "bm9wZQ" })).rejects.toThrow(InvalidCursorError);
    });
});

describe("updateTask", () => {
    let updateTask;
    let getTask;

    beforeEach(() => {
        updateTask = makeUpdateTask({ taskRepository });
        getTask = makeGetTask({ taskRepository });
    });

    it("changes only the fields that were sent", async () => {
        const created = await createTask({ ownerId: ALICE, title: "old", description: "keep" });

        await updateTask({ ownerId: ALICE, id: created.id, changes: { title: "new", done: true } });

        expect(await getTask({ ownerId: ALICE, id: created.id })).toEqual({
            ...created,
            title: "new",
            done: true,
        });
    });

    it("never changes the id, the owner or the creation date", async () => {
        const created = await createTask({ ownerId: ALICE, title: "t" });

        await updateTask({
            ownerId: ALICE,
            id: created.id,
            changes: { id: "hacked", ownerId: BOB, createdAt: "x", done: true },
        });

        expect(await getTask({ ownerId: ALICE, id: created.id })).toEqual({ ...created, done: true });
    });

    it("throws TaskNotFoundError for a missing task and for another user's task", async () => {
        const created = await createTask({ ownerId: ALICE, title: "t" });

        await expect(updateTask({ ownerId: ALICE, id: "missing", changes: { done: true } })).rejects.toThrow(TaskNotFoundError);
        await expect(updateTask({ ownerId: BOB, id: created.id, changes: { done: true } })).rejects.toThrow(TaskNotFoundError);
        expect((await getTask({ ownerId: ALICE, id: created.id })).done).toBe(false);
    });
});

describe("deleteTask", () => {
    let deleteTask;
    let getTask;

    beforeEach(() => {
        deleteTask = makeDeleteTask({ taskRepository });
        getTask = makeGetTask({ taskRepository });
    });

    it("deletes the caller's task", async () => {
        const created = await createTask({ ownerId: ALICE, title: "t" });

        await deleteTask({ ownerId: ALICE, id: created.id });

        await expect(getTask({ ownerId: ALICE, id: created.id })).rejects.toThrow(TaskNotFoundError);
    });

    it("throws TaskNotFoundError for a missing task and leaves another user's task alone", async () => {
        const created = await createTask({ ownerId: ALICE, title: "t" });

        await expect(deleteTask({ ownerId: ALICE, id: "missing" })).rejects.toThrow(TaskNotFoundError);
        await expect(deleteTask({ ownerId: BOB, id: created.id })).rejects.toThrow(TaskNotFoundError);
        expect(await getTask({ ownerId: ALICE, id: created.id })).toEqual(created);
    });
});

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InvalidCursorError, TaskNotFoundError } from "../src/domain/errors.js";
import { generateUuidV7 } from "../src/infrastructure/uuidV7.js";

const START = Date.UTC(2026, 0, 1);

// Every case works on owners and tasks of its own, so implementations that keep state between
// cases (a shared table) cannot make one case see another's data.
const newOwner = () => `owner-${randomUUID()}`;

// Ids from increasing milliseconds, so "oldest first" means the same thing for every
// implementation: by creation time, which is the order of the sort key.
let tick = 0;
const newTask = (ownerId, overrides = {}) => {
    const moment = START + tick++;

    return {
        id: generateUuidV7(() => moment),
        ownerId,
        title: "title",
        description: "description",
        createdAt: new Date(moment).toISOString(),
        done: false,
        ...overrides,
    };
};

const createTasks = async (repository, ownerId, count) => {
    const tasks = [];

    for (let index = 0; index < count; index++) {
        const task = newTask(ownerId);
        await repository.create(task);
        tasks.push(task);
    }

    return tasks;
};

const listAll = async (repository, ownerId, limit) => {
    const items = [];
    let cursor;

    do {
        const page = await repository.listByOwner(ownerId, { limit, cursor });
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);

    return items;
};

/**
 * Registers the cases every TaskRepository implementation must pass: the behavior documented in
 * src/domain/taskRepository.js. The cursor is treated as opaque, and a duplicate create is only
 * required to reject, because the port names no error for it.
 *
 * @param {string} name
 * @param {() => import("../src/domain/taskRepository.js").TaskRepository} createRepository
 */
export const describeTaskRepositoryContract = (name, createRepository) => {
    describe(`${name} honors the TaskRepository contract`, () => {
        const repository = createRepository();

        describe("create", () => {
            it("stores a task that can be read back", async () => {
                const owner = newOwner();
                const task = newTask(owner);

                await repository.create(task);

                expect(await repository.findById(owner, task.id)).toEqual(task);
            });

            it("never overwrites an existing task", async () => {
                const owner = newOwner();
                const task = newTask(owner);
                await repository.create(task);

                await expect(repository.create({ ...task, title: "other" })).rejects.toThrow();

                expect((await repository.findById(owner, task.id)).title).toBe("title");
            });
        });

        describe("findById", () => {
            it("resolves null for a task that does not exist", async () => {
                expect(await repository.findById(newOwner(), newTask(newOwner()).id)).toBeNull();
            });

            it("resolves null for another owner's task", async () => {
                const task = newTask(newOwner());
                await repository.create(task);

                expect(await repository.findById(newOwner(), task.id)).toBeNull();
            });
        });

        describe("listByOwner", () => {
            it("returns only the owner's tasks, oldest first", async () => {
                const owner = newOwner();
                const tasks = await createTasks(repository, owner, 3);
                await createTasks(repository, newOwner(), 2);

                const { items, nextCursor } = await repository.listByOwner(owner, { limit: 10 });

                expect(items).toEqual(tasks);
                expect(nextCursor).toBeNull();
            });

            it("is empty for an owner without tasks", async () => {
                expect(await repository.listByOwner(newOwner(), { limit: 10 }))
                    .toEqual({ items: [], nextCursor: null });
            });

            it("pages with an opaque cursor until nextCursor is null, without gaps or repeats", async () => {
                const owner = newOwner();
                const tasks = await createTasks(repository, owner, 5);

                const first = await repository.listByOwner(owner, { limit: 2 });

                expect(first.items).toEqual(tasks.slice(0, 2));
                expect(first.nextCursor).not.toBeNull();
                expect(await listAll(repository, owner, 2)).toEqual(tasks);
            });

            // DynamoDB hands out a cursor after a page that exactly exhausts the items, and the next
            // page is then empty. The port only promises a null cursor when there are no more pages,
            // so the contract accepts that trailing empty page and checks the end is reached.
            it("reaches a null cursor after the last item, without gaps or repeats", async () => {
                const owner = newOwner();
                const tasks = await createTasks(repository, owner, 4);

                const pages = [];
                let cursor;

                do {
                    const page = await repository.listByOwner(owner, { limit: 2, cursor });
                    pages.push(page);
                    cursor = page.nextCursor ?? undefined;
                } while (cursor !== undefined);

                expect(pages.flatMap((page) => page.items)).toEqual(tasks);
                expect(pages.at(-1).nextCursor).toBeNull();
            });

            it("rejects a cursor it cannot decode with InvalidCursorError", async () => {
                await expect(repository.listByOwner(newOwner(), { limit: 2, cursor: "not-a-cursor" }))
                    .rejects.toBeInstanceOf(InvalidCursorError);
            });

            it("never exposes another owner's tasks through a cursor from that owner's listing", async () => {
                const other = newOwner();
                await createTasks(repository, other, 3);
                const { nextCursor } = await repository.listByOwner(other, { limit: 1 });
                const owner = newOwner();
                await createTasks(repository, owner, 1);

                // The port allows rejecting a foreign cursor or ignoring it; it never allows
                // returning someone else's tasks.
                const outcome = await repository.listByOwner(owner, { limit: 10, cursor: nextCursor })
                    .catch((error) => error);

                if (outcome instanceof Error) {
                    expect(outcome).toBeInstanceOf(InvalidCursorError);
                } else {
                    expect(outcome.items.every((task) => task.ownerId === owner)).toBe(true);
                }
            });
        });

        describe("update", () => {
            it("changes only the updatable fields", async () => {
                const owner = newOwner();
                const task = newTask(owner);
                await repository.create(task);

                await repository.update(owner, task.id, { title: "new", done: true, ownerId: "intruder", createdAt: "x" });

                expect(await repository.findById(owner, task.id))
                    .toEqual({ ...task, title: "new", done: true });
            });

            it("resolves the task as it is after the change", async () => {
                const owner = newOwner();
                const task = newTask(owner);
                await repository.create(task);

                const updated = await repository.update(owner, task.id, { title: "new", done: true, ownerId: "intruder" });

                expect(updated).toEqual({ ...task, title: "new", done: true });
                expect(updated).toEqual(await repository.findById(owner, task.id));
            });

            it("leaves the fields it was not given as they were", async () => {
                const owner = newOwner();
                const task = newTask(owner);
                await repository.create(task);

                await repository.update(owner, task.id, { description: "changed" });

                expect(await repository.findById(owner, task.id)).toEqual({ ...task, description: "changed" });
            });

            it("rejects with TaskNotFoundError for a task that does not exist", async () => {
                await expect(repository.update(newOwner(), newTask(newOwner()).id, { title: "x" }))
                    .rejects.toBeInstanceOf(TaskNotFoundError);
            });

            it("rejects with TaskNotFoundError for another owner's task and leaves it untouched", async () => {
                const owner = newOwner();
                const task = newTask(owner);
                await repository.create(task);

                await expect(repository.update(newOwner(), task.id, { title: "hijacked" }))
                    .rejects.toBeInstanceOf(TaskNotFoundError);

                expect(await repository.findById(owner, task.id)).toEqual(task);
            });
        });

        describe("delete", () => {
            it("removes the task", async () => {
                const owner = newOwner();
                const task = newTask(owner);
                await repository.create(task);

                await repository.delete(owner, task.id);

                expect(await repository.findById(owner, task.id)).toBeNull();
            });

            it("rejects with TaskNotFoundError for a task that does not exist", async () => {
                await expect(repository.delete(newOwner(), newTask(newOwner()).id))
                    .rejects.toBeInstanceOf(TaskNotFoundError);
            });

            it("rejects with TaskNotFoundError for another owner's task and leaves it in place", async () => {
                const owner = newOwner();
                const task = newTask(owner);
                await repository.create(task);

                await expect(repository.delete(newOwner(), task.id))
                    .rejects.toBeInstanceOf(TaskNotFoundError);

                expect(await repository.findById(owner, task.id)).toEqual(task);
            });
        });
    });
};

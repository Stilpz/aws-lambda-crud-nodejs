import { createApiClient } from "./client.js";

// Never run: it exists so that `npm run api:typecheck` compiles one call per operation of the
// contract. Removing or renaming a path, method, parameter or body field in docs/openapi.yaml
// turns the matching line into a type error after the types are regenerated.

/** @param {import("./schema.js").Task} task a task in the shape the contract declares */
const isDone = (task) => task.done;

export const exerciseContract = async () => {
    const client = createApiClient({ baseUrl: "https://example.invalid", getToken: () => "token" });

    await client.GET("/");

    const created = await client.POST("/tasks", { body: { title: "Write docs", description: "Add a README" } });
    const page = await client.GET("/tasks", { params: { query: { limit: 10 } } });
    const nextPage = await client.GET("/tasks", { params: { query: { nextToken: page.data?.nextToken ?? undefined } } });

    const id = created.data?.id ?? "";
    await client.GET("/tasks/{id}", { params: { path: { id } } });
    const patched = await client.PATCH("/tasks/{id}", { params: { path: { id } }, body: { done: true } });
    await client.PUT("/tasks/{id}", { params: { path: { id } }, body: { title: "New title" } });
    await client.DELETE("/tasks/{id}", { params: { path: { id } } });

    return { done: patched.data ? isDone(patched.data) : false, more: nextPage.data?.items.length };
};

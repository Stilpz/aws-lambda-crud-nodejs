import { describe, expect, it } from "vitest";
import { createApiClient } from "../api-client/client.js";

const BASE_URL = "https://api.example.invalid";

// A fetch double that records the Request openapi-fetch builds and answers with a JSON body.
const recordingFetch = (body = {}, status = 200) => {
    const requests = [];
    const fetch = async (request) => {
        requests.push(request);

        return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    };

    return { fetch, requests };
};

const clientWith = (getToken, fetchDouble) => createApiClient({ baseUrl: BASE_URL, getToken, fetch: fetchDouble.fetch });

describe("createApiClient", () => {
    it("builds the URL from the path and the query parameters", async () => {
        const double = recordingFetch({ items: [], nextToken: null });

        await clientWith(() => "token", double).GET("/tasks", { params: { query: { limit: 10, nextToken: "abc" } } });

        expect(double.requests[0].method).toBe("GET");
        expect(double.requests[0].url).toBe(`${BASE_URL}/tasks?limit=10&nextToken=abc`);
    });

    it("fills the path parameter", async () => {
        const double = recordingFetch({});

        await clientWith(() => "token", double).GET("/tasks/{id}", { params: { path: { id: "0b9f5c1e" } } });

        expect(double.requests[0].url).toBe(`${BASE_URL}/tasks/0b9f5c1e`);
    });

    it("sends the bearer token it gets for each request", async () => {
        const double = recordingFetch({});
        let token = "first";
        const client = clientWith(() => token, double);

        await client.GET("/tasks/{id}", { params: { path: { id: "1" } } });
        token = "refreshed";
        await client.GET("/tasks/{id}", { params: { path: { id: "1" } } });

        expect(double.requests.map((request) => request.headers.get("Authorization")))
            .toEqual(["Bearer first", "Bearer refreshed"]);
    });

    it("waits for an asynchronous token", async () => {
        const double = recordingFetch({});

        await clientWith(async () => "later", double).GET("/tasks/{id}", { params: { path: { id: "1" } } });

        expect(double.requests[0].headers.get("Authorization")).toBe("Bearer later");
    });

    it("sends no credentials when there is no token", async () => {
        const double = recordingFetch({ message: "Hello, World!" });

        await clientWith(() => undefined, double).GET("/");

        expect(double.requests[0].headers.has("Authorization")).toBe(false);
    });

    it("sends the body of a PATCH as JSON", async () => {
        const double = recordingFetch({});

        await clientWith(() => "token", double).PATCH("/tasks/{id}", { params: { path: { id: "1" } }, body: { done: true } });

        const [request] = double.requests;
        expect(request.method).toBe("PATCH");
        expect(request.headers.get("Content-Type")).toBe("application/json");
        expect(await request.json()).toEqual({ done: true });
    });

    it("returns the parsed body as data and an error body as error", async () => {
        const created = recordingFetch({ id: "1", title: "t" }, 201);
        const invalid = recordingFetch({ message: "Event object failed validation", errors: ["/body must have required property 'title'"] }, 400);

        const ok = await clientWith(() => "token", created).POST("/tasks", { body: { title: "t" } });
        const failed = await clientWith(() => "token", invalid).POST("/tasks", { body: { title: "t" } });

        expect(ok.data).toEqual({ id: "1", title: "t" });
        expect(failed.error?.message).toBe("Event object failed validation");
    });
});

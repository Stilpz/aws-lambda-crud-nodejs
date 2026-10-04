import createClient from "openapi-fetch";

/** @typedef {import("./schema.js").paths} Paths */

/**
 * A typed client for the Tasks API: every path, method, parameter and body is checked against
 * `docs/openapi.yaml` through the generated types.
 *
 * `getToken` is called before each request, so a refreshed token is picked up without recreating
 * the client. When it resolves nothing, the request goes out without credentials (public routes).
 *
 * @param {{
 *   baseUrl: string,
 *   getToken: () => string | undefined | Promise<string | undefined>,
 *   fetch?: typeof globalThis.fetch,
 * }} options
 * @returns {import("openapi-fetch").Client<Paths>}
 */
export const createApiClient = ({ baseUrl, getToken, fetch }) => {
    /** @type {import("openapi-fetch").Client<Paths>} */
    const client = createClient({ baseUrl, fetch });

    client.use({
        onRequest: async ({ request }) => {
            const token = await getToken();

            if (token) {
                request.headers.set("Authorization", `Bearer ${token}`);
            }

            return request;
        },
    });

    return client;
};

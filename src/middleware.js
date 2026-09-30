import middy from "@middy/core";
import jsonBodyParser from "@middy/http-json-body-parser";
import httpErrorHandler from "@middy/http-error-handler";

// http-error-handler answers with a plain-text message; wrap it so error
// responses keep the { "message": "..." } shape used by every handler.
const jsonErrorMessage = () => ({
    onError: (request) => {
        const { error } = request;

        if (error?.statusCode && error.statusCode < 500 && typeof error.message === "string") {
            error.message = JSON.stringify({ message: error.message });
        }
    },
});

// Handlers that read a JSON request body: parses it into event.body and turns
// middleware errors (415 unsupported media type, 422 malformed JSON) into
// proper HTTP responses instead of Lambda failures.
export const withJsonBody = (handler) =>
    middy(handler)
        .use(jsonBodyParser())
        .use(httpErrorHandler())
        .use(jsonErrorMessage());

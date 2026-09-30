import middy from "@middy/core";
import jsonBodyParser from "@middy/http-json-body-parser";
import httpErrorHandler from "@middy/http-error-handler";
import validator from "@middy/validator";
import Ajv from "ajv";

// strictRequired is disabled so "anyOf: [{ required }]" schemas are allowed. Ajv does not
// coerce types by default, so e.g. "true" is not accepted as a boolean.
const ajv = new Ajv({ allErrors: true, strictRequired: false });

// http-error-handler answers with a plain-text message; wrap it so error
// responses keep the { "message": "..." } shape used by every handler, and
// list which fields failed when the validator rejected the request.
const jsonErrorMessage = () => ({
    onError: (request) => {
        const { error } = request;

        if (!error?.statusCode || error.statusCode >= 500 || typeof error.message !== "string") {
            return;
        }

        const validationErrors = error.cause?.data;
        const details = Array.isArray(validationErrors)
            ? { errors: validationErrors.map(({ instancePath, message }) => `${instancePath} ${message}`) }
            : {};

        error.message = JSON.stringify({ message: error.message, ...details });
    },
});

// Handlers that read a JSON request body: parses it into event.body, validates
// the event against a JSON Schema (400 on failure) and turns middleware errors
// (415 unsupported media type, 422 malformed JSON) into proper HTTP responses
// instead of Lambda failures.
export const withJsonBody = (handler, eventSchema) => {
    const wrapped = middy(handler).use(jsonBodyParser());

    if (eventSchema) {
        wrapped.use(validator({ eventSchema: ajv.compile(eventSchema) }));
    }

    return wrapped.use(httpErrorHandler()).use(jsonErrorMessage());
};

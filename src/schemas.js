const title = { type: "string", pattern: "\\S" };
const description = { type: "string" };
const done = { type: "boolean" };

export const createTaskSchema = {
    type: "object",
    required: ["body"],
    properties: {
        body: {
            type: "object",
            required: ["title"],
            properties: { title, description },
        },
    },
};

export const updateTaskSchema = {
    type: "object",
    required: ["body"],
    properties: {
        body: {
            type: "object",
            properties: { title, description, done },
            anyOf: [
                { required: ["title"] },
                { required: ["description"] },
                { required: ["done"] },
            ],
        },
    },
};

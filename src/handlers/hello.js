import { withObservability } from "./withObservability.js";

export const hello = withObservability(async () => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "Hello, World!",
    }),
  };
});

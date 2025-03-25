import { createTool } from "@mastra/core";
import { z } from "zod";
export const linkCheckerTool = createTool({
  id: "link-checker",
  description: "Check if a link you are about to share is valid",
  inputSchema: z.object({
    link: z.string({
      message: "The link you are about to share",
    }),
  }),
  outputSchema: z.boolean({
    message: "Whether the link is valid, true if it is, false if it is not",
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.logger;
    try {
      const { link } = context;
      logger?.info("Checking link:", { link });
      const response = await fetch(link, { method: "HEAD" });
      logger?.info("Response:", { response });
      return response.ok;
    } catch (error) {
      logger?.error("Error checking link:", { error });
      return false;
    }
  },
});

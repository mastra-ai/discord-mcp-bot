import {
  InteractionType,
  InteractionResponseType,
  verifyKey,
} from "discord-interactions";
import express from "express";
import { config } from "dotenv";
import { mastra } from "../src/mastra";

config();

// Add these constants at the top of the file, after imports
const MAX_MESSAGE_LENGTH = 2000; // Maximum characters allowed
const DISCORD_MESSAGE_LENGTH_LIMIT = 1990;
const COOLDOWN_PERIOD = 10000; // 10 seconds in milliseconds
const userCooldowns = new Map<string, number>();

const app = express();

// Add logging to help debug
app.use((req, res, next) => {
  console.log("Incoming request:", {
    method: req.method,
    path: req.path,
    headers: req.headers,
  });
  next();
});

// Combine JSON parsing and verification into one middleware
app.post("/interactions", express.json(), async (req, res, next) => {
  const signature = req.headers["x-signature-ed25519"];
  const timestamp = req.headers["x-signature-timestamp"];

  console.log("Verification headers:", { signature, timestamp });

  if (!signature || !timestamp) {
    console.error("Missing signature or timestamp");
    return res.status(401).send("Invalid request signature");
  }

  const isValidRequest = await verifyKey(
    Buffer.from(JSON.stringify(req.body)),
    signature as string,
    timestamp as string,
    process.env.DISCORD_PUBLIC_KEY!
  );

  console.log("Request verification:", isValidRequest);

  if (!isValidRequest) {
    return res.status(401).send("Invalid request signature");
  }

  const interaction = req.body;

  console.log("Interaction:", interaction);

  if (interaction.type === InteractionType.PING) {
    return res.send({
      type: InteractionResponseType.PONG,
    });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const { name } = interaction.data;

    if (name === "ask") {
      // Acknowledge the interaction immediately
      await res.send({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: "Thinking about your question...",
        },
      });

      try {
        const content = interaction.data.options[0].value;

        // Check if we're in a DM (channel type 1 is DM)
        const isDM = interaction.channel.type === 1;

        // Make request to your Mastra server
        // const response = await fetch(
        //   `${process.env.MASTRA_URL}/api/agents/discordMCPBotAgent/stream`,
        //   {
        //     method: "POST",
        //     headers: {
        //       "Content-Type": "application/json",
        //     },
        //     body: JSON.stringify({ messages: [{ role: "user", content }] }),
        //   }
        // );

        // const { fullStream } = await response.body;
        const agent = await mastra.getAgent("discordMCPBotAgent");
        const { fullStream } = await agent.stream(content, {
          maxSteps: 10,
        });
        let messageBuffer = "";
        const checksShown = new Map<string, boolean>();

        for await (const part of fullStream) {
          switch (part.type) {
            case "text-delta":
              messageBuffer += part.textDelta;
              break;
            case "tool-call":
              console.log("tool call", part.toolName);
              if (part.toolName.includes("mastra_mastra")) {
                const toolName = part.toolName.replace("mastra_mastra", "");
                if (!checksShown.has(toolName)) {
                  // Send tool call updates via webhook
                  await fetch(
                    `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        content: `Checking ${toolName}. Please wait...`,
                      }),
                    }
                  );
                  checksShown.set(toolName, true);
                }
              }
              break;
            case "tool-result":
              console.log("tool result", part.toolName);
              break;
            case "error":
              console.error("Tool error:", part.error);
              await fetch(
                `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    content: "Sorry, there was an error executing the tool.",
                  }),
                }
              );
              break;
            case "finish":
              break;
          }
          if (messageBuffer.length > 1900) {
            // Send accumulated message via webhook
            await fetch(
              `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: messageBuffer }),
              }
            );
            messageBuffer = "";
          }
        }

        if (messageBuffer.length > 0) {
          // Send final message via webhook
          await fetch(
            `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content: messageBuffer }),
            }
          );
        }
      } catch (error) {
        console.error("Error:", error);
        // Send error message using webhook
        await fetch(
          `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              content: "Sorry, I encountered an error processing your request.",
            }),
          }
        );
      }
    }
  }
});

const PORT = process.env.PORT || 3003;

const server = app
  .listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  })
  .on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `Port ${PORT} is already in use. Please try a different port or close the application using this port.`
      );
      process.exit(1);
    } else if (error.code === "EACCES") {
      console.error(
        `Port ${PORT} requires elevated privileges. Please run with sudo or choose a port number above 1024.`
      );
      process.exit(1);
    } else {
      console.error("Failed to start server:", error);
      process.exit(1);
    }
  });

// Optional: Handle graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received. Shutting down gracefully...");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received. Shutting down gracefully...");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

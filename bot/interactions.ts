import {
  InteractionType,
  InteractionResponseType,
  verifyKey,
} from "discord-interactions";
import { ChannelType, CommandInteraction } from "discord.js"; // Import from discord.js
import express from "express";
import { config } from "dotenv";

config();

// Add these constants at the top of the file, after imports
const MAX_MESSAGE_LENGTH = 2000; // Maximum characters allowed
const DISCORD_MESSAGE_LENGTH_LIMIT = 2000;
const COOLDOWN_PERIOD = 10000; // 10 seconds in milliseconds
const userCooldowns = new Map<string, number>();

const app = express();

// Add logging to help debug
app.use((req, res, next) => {
  next();
});

// Add DM clearing function
async function clearBotDirectMessages(interaction: any): Promise<void> {
  try {
    let messagesDeleted = 0;
    let lastId;

    while (true) {
      // Fetch messages using Discord's API
      const url = `https://discord.com/api/v10/channels/${
        interaction.channel_id
      }/messages?limit=100${lastId ? `&before=${lastId}` : ""}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        },
      });

      const messages = await response.json();
      if (!messages.length) break;

      // Filter bot messages
      const botMessages = messages.filter(
        (msg: any) => msg.author.id === interaction.application_id
      );

      // Delete each bot message
      for (const message of botMessages) {
        await fetch(
          `https://discord.com/api/v10/channels/${interaction.channel_id}/messages/${message.id}`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
            },
          }
        );
        messagesDeleted++;
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Rate limit prevention
      }

      lastId = messages[messages.length - 1].id;
    }
  } catch (error) {
    console.error("Error clearing bot messages:", error);
    throw error;
  }
}

// Helper function to update Discord message
async function updateDiscordMessage(
  interaction: any,
  content: string,
  threadId?: string
) {
  let endpoint: string;
  let method: string;
  let headers: Record<string, string>;

  if (threadId) {
    // Thread message handling
    headers = {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    };

    // Create new message in thread
    endpoint = `https://discord.com/api/v10/channels/${threadId}/messages`;
    method = "POST";
  } else {
    // Non-thread message handling (original interaction response)
    endpoint = `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`;
    method = "PATCH";
    headers = {
      "Content-Type": "application/json",
    };
  }

  const response = await fetch(endpoint, {
    method,
    headers,
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to update message: ${response.status} ${response.statusText}`
    );
  }

  // Return the message data in case we need the ID for future updates
  return await response.json();
}

// Combine JSON parsing and verification into one middleware
app.post("/interactions", express.json(), async (req, res, next) => {
  const signature = req.headers["x-signature-ed25519"];
  const timestamp = req.headers["x-signature-timestamp"];

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

  if (!isValidRequest) {
    return res.status(401).send("Invalid request signature");
  }

  const interaction = req.body;
  const isDM = interaction.channel.type === ChannelType.DM;
  const userId = isDM ? interaction.user.id : interaction.member.user.id;

  if (interaction.type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const { name } = interaction.data;

    if (name === "cleardm") {
      if (!isDM) {
        return res.send({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: "This command can only be used in DMs." },
        });
      }

      await res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: "Deleting my messages..." },
      });

      try {
        await clearBotDirectMessages(interaction);
      } catch (error) {
        console.error("Error:", error);
        await updateDiscordMessage(interaction, "Error clearing messages.");
      }
      return;
    }

    if (name === "ask") {
      let threadId;
      try {
        const content = interaction.data.options[0].value;
        const username = isDM
          ? interaction.user.username
          : interaction.member.user.username;

        // Check message length
        if (content.length > MAX_MESSAGE_LENGTH) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `Sorry, your message is too long (${content.length} characters). Please keep it under ${MAX_MESSAGE_LENGTH} characters.`,
            },
          });
        }

        // Check cooldown
        const now = Date.now();
        const cooldownEnd = userCooldowns.get(userId) || 0;

        if (now < cooldownEnd) {
          const remainingTime = Math.ceil((cooldownEnd - now) / 1000);
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `Please wait ${remainingTime} seconds before sending another message.`,
            },
          });
        }

        // Set cooldown
        userCooldowns.set(userId, now + COOLDOWN_PERIOD);

        if (!isDM) {
          // Create thread
          const threadResponse = await fetch(
            `https://discord.com/api/v10/channels/${interaction.channel_id}/threads`,
            {
              method: "POST",
              headers: {
                Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                name: `Chat with ${username}`,
                auto_archive_duration: 60,
                type: ChannelType.PublicThread,
              }),
            }
          );

          const threadData = await threadResponse.json();
          threadId = threadData.id;

          // Acknowledge with thread creation
          await res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `I've created a thread for our conversation: <#${threadId}>`,
            },
          });

          // Send thinking message
          await updateDiscordMessage(
            interaction,
            "Thinking about your question...",
            threadId
          );
        } else {
          // In DMs, use deferred response
          await res.send({
            type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
          });
        }

        // Make request to Mastra server
        const response = await fetch(
          `${process.env.MASTRA_URL}/api/agents/discordMCPBotAgent/generate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: [{ role: "user", content }] }),
          }
        );
        if (!response.ok) {
          throw new Error("Failed to generate response");
        }
        const data = await response.json();
        await handleResponse(data.text, interaction, threadId);
      } catch (error) {
        // Remove cooldown on error
        userCooldowns.delete(userId);
        console.error("Error:", error);
        await updateDiscordMessage(
          interaction,
          "Sorry, I encountered an error processing your request.",
          threadId
        );
      }
      return;
    }
  }

  return res.status(400).send("Unknown interaction type");
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

async function handleResponse(
  text: string,
  interaction: CommandInteraction,
  threadId?: string
): Promise<void> {
  let remaining = text;

  // Send remaining chunks as new messages
  while (remaining.length > 0) {
    const chunk = remaining.slice(0, DISCORD_MESSAGE_LENGTH_LIMIT);
    remaining = remaining.slice(DISCORD_MESSAGE_LENGTH_LIMIT);
    await updateDiscordMessage(interaction, chunk, threadId);
  }
}

import {
  InteractionType,
  InteractionResponseType,
  verifyKey,
} from "discord-interactions";
import { ChannelType } from "discord.js";
import { config } from "dotenv";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { retryableFetch } from "./helpers/fetch";

config();

// Add these interfaces at the top of the file
interface DiscordMessage {
  id: string;
  author: {
    id: string;
  };
}

interface DiscordThread {
  id: string;
  name: string;
}

interface MastraResponse {
  text: string;
}

const MAX_MESSAGE_LENGTH = 2000;
const DISCORD_MESSAGE_LENGTH_LIMIT = 2000;
const COOLDOWN_PERIOD = 10000; // 10 seconds
const userCooldowns = new Map<string, number>();

async function updateDiscordMessage(
  interaction: any,
  content: string,
  threadId?: string,
  messageId?: string
) {
  try {
    let url;
    const options: RequestInit = {
      method: threadId ? (messageId ? "PATCH" : "POST") : "PATCH",
      headers: {
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content }),
    };

    if (threadId) {
      url = messageId
        ? `https://discord.com/api/v10/channels/${threadId}/messages/${messageId}`
        : `https://discord.com/api/v10/channels/${threadId}/messages`;
    } else {
      url = `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`;
    }

    const response = await retryableFetch<DiscordMessage>(url, options);
    if (!response) throw new Error("Failed to update message");
    return response;
  } catch (error) {
    console.error("REST error:", error);
    throw error;
  }
}

async function handleResponse(
  text: string,
  interaction: any,
  threadId?: string
): Promise<void> {
  let remaining = text;

  while (remaining.length > 0) {
    const chunk = remaining.slice(0, DISCORD_MESSAGE_LENGTH_LIMIT);
    remaining = remaining.slice(DISCORD_MESSAGE_LENGTH_LIMIT);
    await updateDiscordMessage(interaction, chunk, threadId);
  }
}

async function clearBotDirectMessages(interaction: any): Promise<void> {
  console.log("Starting to clear messages...");
  let messagesDeleted = 0;
  let lastId;

  while (true) {
    console.log("Fetching messages batch, lastId:", lastId);

    try {
      const url: string = `https://discord.com/api/v10/channels/${
        interaction.channel_id
      }/messages?limit=100${lastId ? `&before=${lastId}` : ""}`;

      const messages = await retryableFetch<DiscordMessage[]>(url, {
        headers: {
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
      });

      console.log("Messages received:", messages?.length || 0);

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        break;
      }

      const botMessages = messages.filter(
        (msg) => msg.author.id === interaction.application_id
      );

      for (const message of botMessages) {
        try {
          const deleteUrl = `https://discord.com/api/v10/channels/${interaction.channel_id}/messages/${message.id}`;
          await retryableFetch(deleteUrl, {
            method: "DELETE",
            headers: {
              Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
              "Content-Type": "application/json",
            },
          });
          messagesDeleted++;
          await new Promise((resolve) => setTimeout(resolve, 1000)); // Rate limit compliance
        } catch (deleteError) {
          console.error("Failed to delete message:", message.id, deleteError);
        }
      }

      lastId = messages[messages.length - 1].id;
    } catch (batchError) {
      console.error("Batch processing failed:", batchError);
      break;
    }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const signature = req.headers["x-signature-ed25519"] as string;
  const timestamp = req.headers["x-signature-timestamp"] as string;

  if (!signature || !timestamp) {
    return res.status(401).send("Invalid request signature");
  }

  const isValidRequest = await verifyKey(
    Buffer.from(JSON.stringify(req.body)),
    signature,
    timestamp,
    process.env.DISCORD_PUBLIC_KEY!
  );

  if (!isValidRequest) {
    return res.status(401).send("Invalid request signature");
  }

  const interaction = req.body;
  if (interaction.type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }
  const isDM = interaction.channel.type === ChannelType.DM;
  const userId = isDM ? interaction.user.id : interaction.member.user.id;

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

        if (content.length > MAX_MESSAGE_LENGTH) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `Sorry, your message is too long (${content.length} characters). Please keep it under ${MAX_MESSAGE_LENGTH} characters.`,
            },
          });
        }

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

        userCooldowns.set(userId, now + COOLDOWN_PERIOD);

        if (!isDM) {
          // Create thread using retryableFetch
          const threadData = await retryableFetch<DiscordThread>(
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

          if (!threadData?.id) throw new Error("Failed to create thread");
          threadId = threadData.id;

          await res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `I've created a thread for our conversation: <#${threadId}>`,
            },
          });

          // Echo the question
          await updateDiscordMessage(interaction, `> ${content}`, threadId);

          await updateDiscordMessage(
            interaction,
            "Thinking about your question...",
            threadId
          );
        } else {
          await res.send({
            type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
          });

          await updateDiscordMessage(interaction, `> ${content}`);
        }

        const response = await retryableFetch<MastraResponse>(
          `${process.env.MASTRA_URL}/api/agents/discordMCPBotAgent/generate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: [{ role: "user", content }] }),
          }
        );

        if (!response?.text) {
          throw new Error("Invalid response from Mastra");
        }

        await handleResponse(response.text, interaction, threadId);
      } catch (error) {
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
}

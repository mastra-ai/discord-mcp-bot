import {
  InteractionType,
  InteractionResponseType,
  verifyKey,
} from "discord-interactions";
import { ChannelType, REST } from "discord.js";
import { Routes } from "discord-api-types/v10";
import { config } from "dotenv";
import type { VercelRequest, VercelResponse } from "@vercel/node";

config();

const rest = new REST({ version: "10" }).setToken(
  process.env.DISCORD_BOT_TOKEN!
);

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
    if (threadId) {
      if (messageId) {
        return await rest.patch(Routes.channelMessage(threadId, messageId), {
          body: { content },
        });
      } else {
        return await rest.post(Routes.channelMessages(threadId), {
          body: { content },
        });
      }
    } else {
      return await rest.patch(
        Routes.webhookMessage(
          interaction.application_id,
          interaction.token,
          "@original"
        ),
        { body: { content } }
      );
    }
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
  try {
    console.log("Starting to clear messages...");
    let messagesDeleted = 0;
    let lastId;

    while (true) {
      console.log("Fetching messages batch, lastId:", lastId);
      const queryString = new URLSearchParams({
        limit: "100",
        ...(lastId ? { before: lastId } : {}),
      });

      console.log(
        "Making request to:",
        `${Routes.channelMessages(interaction.channel_id)}?${queryString}`
      );
      const messages = (await rest.get(
        `${Routes.channelMessages(interaction.channel_id)}?${queryString}`
      )) as any[];

      console.log("Received messages:", messages.length);

      if (!messages.length) break;

      const botMessages = messages.filter(
        (msg) => msg.author.id === interaction.application_id
      );

      console.log("Found bot messages:", botMessages.length);

      for (const message of botMessages) {
        await rest.delete(
          Routes.channelMessage(interaction.channel_id, message.id)
        );
        messagesDeleted++;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      lastId = messages[messages.length - 1].id;
      console.log("Updated lastId:", lastId);
    }
    console.log("Finished clearing messages, total deleted:", messagesDeleted);
  } catch (error) {
    console.error("Error clearing bot messages:", error);
    throw error;
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
          const threadData = (await rest.post(
            Routes.threads(interaction.channel_id),
            {
              body: {
                name: `Chat with ${username}`,
                auto_archive_duration: 60,
                type: ChannelType.PublicThread,
              },
            }
          )) as any;
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

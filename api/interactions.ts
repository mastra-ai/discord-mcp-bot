import {
  InteractionType,
  InteractionResponseType,
  verifyKey,
} from "discord-interactions";
import { ChannelType } from "discord.js";
import { config } from "dotenv";
import type { VercelRequest, VercelResponse } from "@vercel/node";

config();

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
  let endpoint: string;
  let method: string;
  let headers: Record<string, string>;

  if (threadId) {
    headers = {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    };

    if (messageId) {
      endpoint = `https://discord.com/api/v10/channels/${threadId}/messages/${messageId}`;
      method = "PATCH";
    } else {
      endpoint = `https://discord.com/api/v10/channels/${threadId}/messages`;
      method = "POST";
    }
  } else {
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

  return await response.json();
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
    let messagesDeleted = 0;
    let lastId;

    while (true) {
      const url: string = `https://discord.com/api/v10/channels/${
        interaction.channel_id
      }/messages?limit=100${lastId ? `&before=${lastId}` : ""}`;
      const response: any = await fetch(url, {
        headers: {
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        },
      });

      const messages = await response.json();
      if (!messages.length) break;

      const botMessages = messages.filter(
        (msg: any) => msg.author.id === interaction.application_id
      );

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
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      lastId = messages[messages.length - 1].id;
    }
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
            body: JSON.stringify({
              messages: [{ role: "user", content }],
            }),
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

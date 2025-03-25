
import { retryableFetch } from "./helpers/fetch.js";

// Add these interfaces at the top of the file
interface DiscordMessage {
  id: string;
  author: {
    id: string;
  };
}

export interface DiscordThread {
  id: string;
  name: string;
}

export interface MastraResponse {
  text: string;
}

export const MAX_MESSAGE_LENGTH = 2000;
export const DISCORD_MESSAGE_LENGTH_LIMIT = 2000;
export const COOLDOWN_PERIOD = 10000; // 10 seconds
export const userCooldowns = new Map<string, number>();

export async function updateDiscordMessage(
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

export async function clearBotDirectMessages(interaction: any): Promise<void> {
  console.log("Starting to clear messages...");
  let messagesDeleted = 0;
  let lastId;

  try {
    while (true) {
      console.log("Fetching messages batch, lastId:", lastId);

      try {
        const url: string = `https://discord.com/api/v10/channels/${interaction.channel_id
          }/messages?limit=100${lastId ? `&before=${lastId}` : ""}`;

        const options = {
          method: "GET", // Explicitly setting the method
          headers: {
            Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
            "Content-Type": "application/json",
          },
        };

        console.log("Making request with:", {
          url,
          method: options.method,
        });

        const messages = await retryableFetch<DiscordMessage[]>(url, options);

        console.log("Messages received:", messages?.length || 0);

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
          break;
        }

        const botMessages = messages.filter(
          (msg) => msg.author.id === interaction.application_id
        );
        console.log(`Found ${botMessages.length} bot messages to delete`);

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
  } catch (error) {
    console.error("Error in clearBotDirectMessages:", error);
    console.error("Error clearing messages:", error);
    throw error;
  }
}
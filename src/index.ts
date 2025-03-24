import { ChannelType, Client, GatewayIntentBits, Partials, DMChannel } from 'discord.js';
import { config } from 'dotenv';
import { mastra } from './mastra';
config();

let client: Client | null = null;

// Add these constants at the top of the file, after imports
const MAX_MESSAGE_LENGTH = 2000; // Maximum characters allowed
const DISCORD_MESSAGE_LENGTH_LIMIT = 1990;
const COOLDOWN_PERIOD = 10000; // 10 seconds in milliseconds
const userCooldowns = new Map<string, number>();

async function clearBotDirectMessages(channel: DMChannel): Promise<void> {
  try {
    let messagesDeleted = 0;
    let messages;

    do {
      // Fetch up to 100 messages at a time
      messages = await channel.messages.fetch({ limit: 100 });

      // Filter for only bot's own messages
      const botMessages = messages.filter(msg => msg.author.id === channel.client.user.id);

      // If no bot messages are found, break the loop
      if (botMessages.size === 0) break;

      // Delete each bot message
      for (const message of botMessages.values()) {
        if (message.deletable) {
          await message.delete();
          messagesDeleted++;

          // Add a small delay to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } while (messages.size >= 100);

    console.log(`Successfully deleted ${messagesDeleted} bot messages`);
  } catch (error) {
    console.error('Error clearing bot messages:', error);
    throw error;
  }
}

async function getDiscordClient(): Promise<Client> {
  if (client && client.isReady()) {
    console.log('Using existing Discord client');
    return client;
  }

  console.log('Creating new Discord client');
  // Create a new client if one doesn't exist or isn't ready
  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  // Log in to Discord
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    throw new Error("DISCORD_BOT_TOKEN is not set in environment variables");
  }

  console.log("Logging in to Discord...");
  return new Promise((resolve, reject) => {
    // Add message listener here, before the 'ready' event
    client!.on("messageCreate", async (message) => {
      // Ignore messages from bots
      if (message.author.bot) return;

      // Check if the message is a DM or if the bot was mentioned
      const isMentioned = message.mentions.users.has(client!.user!.id);
      const isDM = message.channel.type === ChannelType.DM;

      if (!isDM && !isMentioned) return;

      // Remove bot mention from content if it exists
      let content = message.content
        .replace(new RegExp(`<@!?${client!.user!.id}>`, "g"), "")
        .trim();

      if (!content) {
        await message.reply("Hello! How can I help you?");
        return;
      }

      if (content.length > MAX_MESSAGE_LENGTH) {
        await message.reply(
          `Sorry, your message is too long (${content.length} characters). ` +
            `Please keep it under ${MAX_MESSAGE_LENGTH} characters.`
        );
        return;
      }

      // Check cooldown
      const now = Date.now();
      const cooldownEnd = userCooldowns.get(message.author.id) || 0;

      if (now < cooldownEnd) {
        const remainingTime = Math.ceil((cooldownEnd - now) / 1000);
        await message.reply(
          `Please wait ${remainingTime} seconds before sending another message.`
        );
        return;
      }

      if (isDM && content === "!cleardm") {
        await message.reply("Deleting my messages...");
        await clearBotDirectMessages(message.channel as DMChannel);
        return;
      }

      try {
        // Set cooldown before processing
        userCooldowns.set(message.author.id, now + COOLDOWN_PERIOD);

        // Create a thread if we're not in a DM or thread already
        const responseChannel =
          isDM || message.channel.isThread()
            ? message.channel
            : await message.startThread({
                name: `Question from ${message.author.username}`,
                autoArchiveDuration: 60,
              });

        // First message in response should be a reply for context
        await responseChannel.send("Let me help you with that!");

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
                  await message.reply(`Checking ${toolName}. Please wait...`);
                  checksShown.set(toolName, true);
                }
              }
              break;
            case "tool-result":
              console.log("tool result", part.toolName);
              // if (part.toolName.includes('codeFileTool')) {
              //   try {
              //     const filepath = part.result;
              //     if (filepath && typeof filepath === 'string') {
              //       filesToSend.push(filepath);
              //     }
              //   } catch (error) {
              //     console.error('Error handling tool result:', error);
              //     await message.channel.send('Sorry, there was an error processing the code file.');
              //   }
              // }
              console.log("finished tool call");
              break;
            case "error":
              console.error("Tool error:", part.error);
              await message.reply(
                "Sorry, there was an error executing the tool."
              );
              break;
            case "finish":
              break;
          }
          if (messageBuffer.length > DISCORD_MESSAGE_LENGTH_LIMIT) {
            // Use send() for stream chunks to avoid spam
            await responseChannel.send(messageBuffer);
            messageBuffer = "";
          }
        }

        if (messageBuffer.length > 0) {
          // Use send() for the final message if it's part of a stream
          await responseChannel.send(messageBuffer);
        }
      } catch (error: any) {
        console.error("Error processing message:", error);

        // Remove cooldown on error
        userCooldowns.delete(message.author.id);

        const errorMessage =
          error?.lastError?.statusCode === 429 &&
          error?.lastError?.data?.error?.code === "rate_limit_exceeded"
            ? "Sorry, the request was too large for me to process. Please try breaking it down into smaller parts or wait a moment before trying again."
            : "Sorry, I encountered an error while processing your request. Please try again later.";

        // Send error message in the appropriate channel
        if (message.channel.isThread() || isDM) {
          await message.reply(errorMessage);
        } else {
          const thread = await message.startThread({
            name: `Error Response for ${message.author.username}`,
            autoArchiveDuration: 60,
          });
          await thread.send(errorMessage);
        }
      }
    });

    client!.once("ready", () => {
      console.log(`Logged in as ${client!.user!.tag}`);
      resolve(client!);
    });

    client!.once("error", (error) => {
      console.error("Discord client error:", error);
      reject(error);
    });

    client!.login(token).catch((error) => {
      console.error("Discord login error:", error);
      reject(error);
    });
  });
}

async function main() {
  try {
    const discord = await getDiscordClient();
    console.log('Bot is ready!');
  } catch (error) {
    console.error('Failed to start bot:', error);
    process.exit(1);
  }
}

// Start the bot
main();

// Optional: Add a cleanup interval for the cooldowns map
setInterval(() => {
  const now = Date.now();
  for (const [userId, cooldownEnd] of userCooldowns.entries()) {
    if (cooldownEnd < now) {
      userCooldowns.delete(userId);
    }
  }
}, 60000); // Clean up every minute

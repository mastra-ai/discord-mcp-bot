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
      //   GatewayIntentBits.GuildMembers,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  // Log in to Discord
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    throw new Error('DISCORD_BOT_TOKEN is not set in environment variables');
  }

  console.log('Logging in to Discord...');
  return new Promise((resolve, reject) => {
    // Add message listener here, before the 'ready' event
    client!.on('messageCreate', async message => {
      // Ignore messages from bots and non-DM channels
      if (message.author.bot || message.channel.type !== ChannelType.DM) return;

      // Check message length
      if (message.content.length > MAX_MESSAGE_LENGTH) {
        await message.reply(
          `Sorry, your message is too long (${message.content.length} characters). ` +
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

      if (
        message.channel.type === ChannelType.DM &&
        message.content === "!cleardm"
      ) {
        await message.reply("Deleting my messages...");
        await clearBotDirectMessages(message.channel as DMChannel);
        return;
      }

      try {
        // Set cooldown before processing
        userCooldowns.set(message.author.id, now + COOLDOWN_PERIOD);

        const agent = await mastra.getAgent("discordMCPBotAgent");
        const { fullStream } = await agent.stream(message.content, {
          maxSteps: 10,
        });

        let messageBuffer = "";
        // let filesToSend: string[] = []; // Array to collect file paths
        const checksShown = new Map<string, boolean>();

        for await (const part of fullStream) {
          console.log("part", part);
          switch (part.type) {
            case "text-delta":
              messageBuffer += part.textDelta;
              break;
            case "tool-call":
              console.log("tool call", part.toolName);
              if (part.toolName.includes("mastra_mastra")) {
                const toolName = part.toolName.replace("mastra_mastra", "");
                if (!checksShown.has(toolName)) {
                  await message.channel.send(
                    `Checking ${toolName}. Please wait...`
                  );
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
              await message.channel.send(
                "Sorry, there was an error executing the tool."
              );
              break;
            case "finish":
              break;
          }
          if (messageBuffer.length > DISCORD_MESSAGE_LENGTH_LIMIT) {
            await message.channel.send(messageBuffer);
            messageBuffer = "";
          }
        }

        if (messageBuffer.length > 0) {
          await message.channel.send(messageBuffer);
        }
        messageBuffer = "";
        // Send all collected files together
        // if (filesToSend.length > 0) {
        //   await message.channel.send({
        //     content: 'Here are the code examples:',
        //     files: filesToSend,
        //   });
        //   filesToSend = []; // Clear the array
        // }
      } catch (error: any) {
        console.error("Error processing message:", error);

        // Remove cooldown on error so user can retry immediately
        userCooldowns.delete(message.author.id);

        if (
          error?.lastError?.statusCode === 429 &&
          error?.lastError?.data?.error?.code === "rate_limit_exceeded"
        ) {
          await message.channel.send(
            "Sorry, the request was too large for me to process. Please try breaking it down into smaller parts or wait a moment before trying again."
          );
        } else {
          await message.channel.send(
            "Sorry, I encountered an error while processing your request. Please try again later."
          );
        }
      }
    });

    client!.once('ready', () => {
      console.log(`Logged in as ${client!.user!.tag}`);
      resolve(client!);
    });

    client!.once('error', error => {
      console.error('Discord client error:', error);
      reject(error);
    });

    client!.login(token).catch(error => {
      console.error('Discord login error:', error);
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

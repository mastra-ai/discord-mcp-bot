import { REST, Routes } from "discord.js";
import { config } from "dotenv";

config();

// Define your commands
const commands = [
  {
    name: "ask",
    description: "Ask the AI a question",
    options: [
      {
        name: "question",
        description: "What would you like to ask?",
        type: 3, // STRING type
        required: true,
      },
    ],
  },
];

// Create REST instance
const rest = new REST({ version: "10" }).setToken(
  process.env.DISCORD_BOT_TOKEN!
);

async function registerCommands() {
  try {
    console.log("Started refreshing application (/) commands.");

    await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID!), {
      body: commands,
    });

    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error(error);
  }
}

registerCommands();

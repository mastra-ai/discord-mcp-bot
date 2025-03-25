// delete-commands.ts
import { REST, Routes } from "discord.js";
import { config } from "dotenv";

config();

const rest = new REST({ version: "10" }).setToken(
  process.env.DISCORD_BOT_TOKEN!
);

// Delete all commands
async function deleteCommands() {
  try {
    console.log("Started deleting application (/) commands.");

    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID!),
      { body: [] } // Empty array removes all commands
    );

    console.log("Successfully deleted all application (/) commands.");
  } catch (error) {
    console.error(error);
  }
}

deleteCommands();

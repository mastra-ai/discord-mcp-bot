// list-commands.ts
import { REST, Routes } from "discord.js";
import { config } from "dotenv";

config();

const rest = new REST({ version: "10" }).setToken(
  process.env.DISCORD_BOT_TOKEN!
);

async function listCommands() {
  try {
    const commands = await rest.get(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID!)
    );
    console.log("Registered commands:", commands);
  } catch (error) {
    console.error(error);
  }
}

listCommands();

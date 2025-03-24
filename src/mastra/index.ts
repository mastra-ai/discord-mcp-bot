import { Mastra } from '@mastra/core';
import { createLogger } from '@mastra/core/logger';
import { discordMCPBotAgent } from './agents';

// Create and export the Mastra instance with our Discord analysis agent
export const mastra = new Mastra({
  agents: { discordMCPBotAgent },
  logger: createLogger({ name: 'DiscordMCPBot', level: 'info' }),
});

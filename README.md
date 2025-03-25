# Discord MCP Bot

A Discord bot that uses Mastra's MCP (Model Context Protocol) tools to provide intelligent assistance and answer questions about Mastra.ai.

## Overview

This Discord bot leverages Mastra's MCP tools and GPT-4 to:
- Answer questions about Mastra.ai, its features, and capabilities
- Provide links to relevant documentation and examples
- Offer expert guidance on Mastra.ai implementation
- Share code examples when relevant

## Prerequisites

- Node.js v20.0+
- npm
- OpenAI API key
- Discord bot token

## Getting Started

1. Clone the repository:

   ```bash
   git clone https://github.com/mastra-ai/mastra
   cd examples/discord-mcp-bot
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a `.env` file with your API keys:

   ```
   OPENAI_API_KEY=your_openai_api_key
   DISCORD_BOT_TOKEN=your_discord_bot_token  
   DISCORD_CLIENT_ID=your_discord_client_id
   DISCORD_PUBLIC_KEY=your_discord_public_key
   ```

4. Run the bot:

   ```bash
   npm start
   ```

## Setting Up a Discord Bot

1. Create a Discord application:
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Click "New Application" and give it a name
   - Navigate to the "Bot" tab and click "Add Bot"

2. Configure bot permissions:
   - Under "Privileged Gateway Intents", enable:
     - Message Content Intent
     - Server Members Intent
     - Direct Message Intent

3. Get your bot token:
   - In the Bot tab, click "Reset Token" or "Copy" to get your bot token
   - Add this token to your `.env` file as `DISCORD_BOT_TOKEN`

4. Invite the bot to your server:
   - Go to the "OAuth2" tab, then "URL Generator"
   - Select "bot" under scopes
   - Select required permissions:
     - Read Messages/View Channels
     - Send Messages
     - Read Message History
   - Copy the generated URL and open it in your browser
   - Select your server and authorize the bot

## Features

- **Direct Message Support**: Users can DM the bot to ask questions
- **Intelligent Responses**: Uses GPT-4 to provide accurate and contextual answers
- **Documentation Links**: Provides relevant links to Mastra documentation
- **Code Examples**: Shares appropriate code examples from the Mastra repository
- **Slash Commands**: Uses Discord's slash commands to interact with the bot
   - `/ask`: Ask the bot a question
   - `/cleardm`: Clear the bot messages in the user's DMs
- **Threads**: Uses Discord's threads to provide a better user experience

## Project Structure

- `api/interactions.ts`: Main bot implementation and Discord client setup
- `src/mastra/index.ts`: Mastra instance initialization
- `src/mastra/agents/index.ts`: Discord MCP bot agent configuration
- `src/mastra/tools/index.ts`: Tool implementations for code file handling

## Scripts

- `scripts/register-commands.ts`: Register the bot commands
- `scripts/delete-commands.ts`: Delete the bot commands
- `scripts/list-commands.ts`: List the bot commands

## Implementation Notes

The bot is built with:
- Discord.js for Discord integration
- Mastra MCP tools for intelligent responses
- OpenAI's GPT-4 for natural language understanding
- TypeScript for type safety and better development experience

For production deployment, consider:
- Setting up proper logging
- Implementing rate limiting
- Adding monitoring and error tracking
- Setting up a process manager (PM2, etc.)

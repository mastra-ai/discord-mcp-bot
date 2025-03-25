import express from "express";
import handler from "./api/interactions.js"; // Note the .js extension for ESM

const app = express();
app.use(express.json());

// Wrap the Vercel handler for Express
app.post("/api/interactions", async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

async function main() {
  console.log("Testing Gemini directly...");

  try {
    const response = await client.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: "Reply with exactly: HELLO",
      config: {
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.LOW,
        },
      },
    });

    console.log("SUCCESS");
    console.log(response.text);
  } catch (error) {
    console.error("FAILED");
    console.error(error);
  }
}

main();

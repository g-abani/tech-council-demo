import { AzureChatOpenAI } from "@langchain/openai";
import dotenv from "dotenv";

dotenv.config();

/** Main Azure chat model — supervisor, search summarization (`slm`), dynamic-model branch, etc. */
export const llm = new AzureChatOpenAI({
  model: "gpt-4o",
  temperature: 0,
  maxTokens: undefined,
  maxRetries: 2,
  azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
  azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
  azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
  azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION,
});

// Small Language Model for cheaper operations like summarization
// Falls back to main LLM deployment if separate SLM deployment not configured
export const slm = new AzureChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0,
  maxTokens: undefined,
  maxRetries: 2,
  azureOpenAIApiKey: process.env.AZURE_OPENAI_SLM_API_KEY || process.env.AZURE_OPENAI_API_KEY,
  azureOpenAIApiInstanceName:
    process.env.AZURE_OPENAI_SLM_API_INSTANCE_NAME || process.env.AZURE_OPENAI_API_INSTANCE_NAME,
  azureOpenAIApiDeploymentName: "gpt-4.1-mini",
  azureOpenAIApiVersion: "2025-01-01-preview",
});

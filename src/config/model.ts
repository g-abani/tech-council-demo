/**
 * Azure OpenAI Model Configuration
 * Demonstrates context engineering through proper model setup
 */

import { AzureChatOpenAI } from "@langchain/openai";
import dotenv from "dotenv";

dotenv.config();

/**
 * Create an Azure OpenAI model instance with context engineering best practices
 * - Uses environment variables for configuration (static runtime context)
 * - Configures streaming for better UX
 * - Sets appropriate temperature for reliable outputs
 */
export function createAzureModel(temperature: number = 0.7, deploymentName?: string) {
  const model = new AzureChatOpenAI({
    azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
    azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
    // Use env var as default, allow override
    azureOpenAIApiDeploymentName: deploymentName || process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
    azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION || "2024-08-01-preview",
    temperature,
    maxRetries: 2,  // Match llm config - fail fast instead of long retries
  });

  return model;
}

/**
 * Validate that all required environment variables are set
 */
export function validateEnvironment(): boolean {
  const required = [
    "AZURE_OPENAI_API_KEY",
    "AZURE_OPENAI_API_INSTANCE_NAME",
    "AZURE_OPENAI_API_DEPLOYMENT_NAME",
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error("Missing required environment variables:", missing.join(", "));
    return false;
  }

  return true;
}


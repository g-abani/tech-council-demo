/**
 * Tool Definitions for Worker Agents
 * Demonstrates context engineering through clear tool descriptions
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * Research tool - simulates looking up information
 * In production, this would integrate with real APIs, databases, or search engines
 */
export const researchTool = tool(
  async ({ query }: { query: string }) => {
    // Simulate research with contextual responses
    console.log(`[Research Tool] Searching for: ${query}`);
    
    // Simulate some delay
    //await new Promise((resolve) => setTimeout(resolve, 500));
    
    // Return simulated research results
    const responses: Record<string, string> = {
      default: `Based on my research about "${query}", here are the findings: This is a simulated response. In a production environment, this would connect to real data sources, APIs, or knowledge bases.`,
      weather: "The current weather is sunny with a temperature of 72°F. Perfect day for outdoor activities!",
      news: "Latest tech news: AI continues to advance rapidly with new breakthroughs in multi-agent systems.",
      stock: "Market update: Tech stocks are showing positive momentum with steady growth.",
    };
    
    // Simple keyword matching for demo purposes
    const lowerQuery = query.toLowerCase();
    if (lowerQuery.includes("weather")) return responses.weather;
    if (lowerQuery.includes("news")) return responses.news;
    if (lowerQuery.includes("stock") || lowerQuery.includes("market")) return responses.stock;
    
    return responses.default;
  },
  {
    name: "research_information",
    description: "Searches for and retrieves information about a topic. Use this tool when you need to look up facts, current events, or general knowledge. Provide a clear and specific query.",
    schema: z.object({
      query: z.string().describe("The search query or topic to research"),
    }),
  }
);

/**
 * Calculator tool - performs mathematical calculations
 */
export const calculatorTool = tool(
  async ({ expression }: { expression: string }) => {
    console.log(`[Calculator Tool] Evaluating: ${expression}`);
    
    try {
      // Safe evaluation for basic math operations
      // In production, use a proper math expression parser
      const sanitized = expression.replace(/[^0-9+\-*/().\s]/g, "");
      const result = eval(sanitized);
      
      return `The result of ${expression} is ${result}`;
    } catch (error) {
      return `Error calculating ${expression}: ${error instanceof Error ? error.message : "Invalid expression"}`;
    }
  },
  {
    name: "calculate",
    description: "Performs mathematical calculations. Use this for any arithmetic, algebra, or numerical computations. Provide a mathematical expression using standard operators (+, -, *, /, parentheses).",
    schema: z.object({
      expression: z.string().describe("The mathematical expression to evaluate (e.g., '2 + 2', '10 * 5 + 3')"),
    }),
  }
);

/**
 * Text analysis tool - analyzes text and provides insights
 */
export const textAnalysisTool = tool(
  async ({ text }: { text: string }) => {
    console.log(`[Text Analysis Tool] Analyzing text...`);
    
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const charCount = text.length;
    const sentenceCount = text.split(/[.!?]+/).filter(Boolean).length;
    const avgWordLength = charCount / wordCount || 0;
    
    return `Text Analysis Results:
- Word count: ${wordCount}
- Character count: ${charCount}
- Sentence count: ${sentenceCount}
- Average word length: ${avgWordLength.toFixed(2)} characters
- Sentiment: ${wordCount > 50 ? "Detailed" : "Brief"} text`;
  },
  {
    name: "analyze_text",
    description: "Analyzes text and provides statistics like word count, character count, and basic sentiment. Use this when you need to analyze written content.",
    schema: z.object({
      text: z.string().describe("The text to analyze"),
    }),
  }
);


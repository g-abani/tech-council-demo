import { tool } from "langchain";
import { z } from "zod";
import { getSearchClient } from "./searchClient.js";
import { slm } from "../../../services/llm.js";
import dotenv from "dotenv";
dotenv.config();

export const azureSearchTool = tool(
  async ({ query }: { query: string }) => {
    console.log(`[Azure Search Tool] Searching for: ${query}`);
    const searchResults = await getSearchClient().search(query, {
      top: 3, // limit results
      includeTotalCount: true,
      select: [
        "content_id",
        "document_title",
        "content_text",
        "content_path",
        "text_document_id",
        "image_document_id",
      ],
      searchFields: ["content_text"],
      highlightFields: "content_text",
    });

    let docs = [];
    for await (const result of searchResults.results) {
      const doc = result.document as any;
      docs.push({
        score: result.score,
        rerankerScore: result.rerankerScore || null,
        contentId: doc.content_id,
        title: doc.document_title,
        contentText: doc.content_text,
        contentPath: doc.content_path,
        isImage: !!doc.image_document_id,
        isText: !!doc.text_document_id,
        highlights: result.highlights?.content_text || [],
        captions: result.captions?.map((cap) => cap.text) || [],
      });
    }
    const sortedDocs = docs.sort((a, b) => {
      if (a.rerankerScore && b.rerankerScore) {
        return b.rerankerScore - a.rerankerScore;
      }
      return b.score - a.score;
    });
    const jsonResult = JSON.stringify(sortedDocs, null, 2);

    const summaryPrompt = `You are a helpful assistant. The user asked: "${query}"
      We retrieved the following information from our knowledge base:
      ${jsonResult}
      Please provide a clear, concise, and helpful answer based on these search results. If the results don't contain relevant information, say so politely.`;

      const response = await slm.invoke([
        { role: "user", content: summaryPrompt }
      ]);

    return response.content;
  },
  {
    name: "azure_search_qna",
    description: "Searches internal company knowledge base for information about Adobe projects, tools, and setup guides. Use this for any company-specific topics like Milo, Feds, Project Stream, JIRA MCP, internal tooling, or setup instructions.",
    returnDirect: true,
    schema: z.object({
      query: z.string().describe("The search query or topic to research"),
    }) as any,
  }
);

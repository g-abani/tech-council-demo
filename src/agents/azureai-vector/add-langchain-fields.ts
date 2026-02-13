/**
 * Script to Add LangChain-Compatible Fields to Existing Azure AI Search Index
 * 
 * This script adds the fields that LangChain's AzureAISearchVectorStore expects:
 * - id (aliased from content_id)
 * - content (new field)
 * - content_vector (new field)
 * - metadata (new field)
 * 
 * NOTE: Azure AI Search does NOT allow renaming existing fields.
 * This script adds NEW fields alongside your existing ones.
 */

import { SearchIndexClient, AzureKeyCredential, SearchIndex } from "@azure/search-documents";
import dotenv from "dotenv";

dotenv.config();

const AZURE_SEARCH_ENDPOINT = process.env.AZURE_SEARCH_ENDPOINT;
const AZURE_SEARCH_API_KEY = process.env.AZURE_SEARCH_API_KEY;
const INDEX_NAME = process.env.AZURE_SEARCH_INDEX_NAME || "multimodal-rag-1764420107845";

// Validate required environment variables
if (!AZURE_SEARCH_ENDPOINT || !AZURE_SEARCH_API_KEY) {
  console.error("❌ Missing required environment variables!");
  console.error("");
  console.error("Please add the following to your .env file:");
  console.error("  AZURE_SEARCH_ENDPOINT=https://<your-search-service>.search.windows.net");
  console.error("  AZURE_SEARCH_API_KEY=<your-admin-api-key>");
  console.error("  AZURE_SEARCH_INDEX_NAME=<your-index-name>  (optional)");
  console.error("");
  console.error("Current values:");
  console.error(`  AZURE_SEARCH_ENDPOINT: ${AZURE_SEARCH_ENDPOINT || "(not set)"}`);
  console.error(`  AZURE_SEARCH_API_KEY: ${AZURE_SEARCH_API_KEY ? "(set)" : "(not set)"}`);
  process.exit(1);
}

const indexClient = new SearchIndexClient(
  AZURE_SEARCH_ENDPOINT,
  new AzureKeyCredential(AZURE_SEARCH_API_KEY)
);

/**
 * LangChain-compatible fields to add (using raw object format)
 * Note: Using both vectorSearchProfile AND vectorSearchConfiguration for compatibility
 */
const LANGCHAIN_FIELDS = [
  // LangChain expects 'id' as the key, but we already have content_id as key
  // So we'll add these as additional fields (content_id remains the key)
  {
    name: "content",
    type: "Edm.String",
    searchable: true,
    filterable: false,
    retrievable: true,
    stored: true,
    sortable: false,
    facetable: false,
    key: false,
  },
  {
    name: "content_vector",
    type: "Collection(Edm.Single)",
    searchable: true,
    filterable: false,
    retrievable: true,
    stored: true,
    sortable: false,
    facetable: false,
    key: false,
    vectorSearchDimensions: 1536,
    vectorSearchProfileName: "multimodal-rag-1764420107845-azureOpenAi-text-profile",
  },
  {
    name: "metadata",
    type: "Edm.String",
    searchable: false,
    filterable: false,
    retrievable: true,
    stored: true,
    sortable: false,
    facetable: false,
    key: false,
  },
];

async function addLangChainFields() {
  console.log(`\n📋 Fetching current index: ${INDEX_NAME}`);
  
  // Get current index
  const currentIndex = await indexClient.getIndex(INDEX_NAME);
  console.log(`✅ Found index with ${currentIndex.fields.length} fields`);
  
  // Debug: Show existing vector field structure
  const existingVectorField = currentIndex.fields.find(f => f.name === "content_embedding");
  if (existingVectorField) {
    console.log(`\n🔍 Existing vector field structure:`);
    console.log(JSON.stringify(existingVectorField, null, 2));
  }
  
  // Check which fields already exist
  const existingFieldNames = new Set(currentIndex.fields.map(f => f.name));
  console.log(`\n📝 Existing fields: ${[...existingFieldNames].join(", ")}`);
  
  // Determine which fields need to be added
  const fieldsToAdd: any[] = [];
  for (const field of LANGCHAIN_FIELDS) {
    if (existingFieldNames.has(field.name)) {
      console.log(`⏭️  Field '${field.name}' already exists, skipping`);
    } else {
      fieldsToAdd.push(field);
      console.log(`➕ Will add field: ${field.name} (${field.type})`);
    }
  }
  
  if (fieldsToAdd.length === 0) {
    console.log(`\n✅ All LangChain fields already exist. No changes needed.`);
    return;
  }
  
  // Create updated index definition
  const updatedIndex: SearchIndex = {
    ...currentIndex,
    fields: [...currentIndex.fields, ...fieldsToAdd],
  };
  
  console.log(`\n🔄 Updating index with ${fieldsToAdd.length} new fields...`);
  
  try {
    await indexClient.createOrUpdateIndex(updatedIndex);
    console.log(`✅ Index updated successfully!`);
    console.log(`\n📊 New total fields: ${updatedIndex.fields.length}`);
  } catch (error: any) {
    console.error(`❌ Error updating index:`, error.message);
    throw error;
  }
}

async function showIndexSchema() {
  console.log(`\n📋 Current Index Schema: ${INDEX_NAME}`);
  console.log("=".repeat(60));
  
  const index = await indexClient.getIndex(INDEX_NAME);
  
  console.log(`\n📁 Fields (${index.fields.length}):`);
  for (const field of index.fields) {
    const attrs: string[] = [];
    const f = field as any; // Cast to access all possible properties
    
    if (f.key) attrs.push("KEY");
    if (f.searchable) attrs.push("searchable");
    if (f.filterable) attrs.push("filterable");
    if (f.sortable) attrs.push("sortable");
    if (f.dimensions) {
      attrs.push(`vector(${f.dimensions})`);
    }
    
    console.log(`  - ${field.name}: ${field.type} [${attrs.join(", ")}]`);
  }
  
  if (index.vectorSearch?.profiles) {
    console.log(`\n🔍 Vector Search Profiles:`);
    for (const profile of index.vectorSearch.profiles) {
      console.log(`  - ${profile.name} (algorithm: ${profile.algorithmConfigurationName})`);
    }
  }
  
  // Access semantic config via any cast since it may not be in all SDK versions
  const indexAny = index as any;
  if (indexAny.semantic?.configurations) {
    console.log(`\n🧠 Semantic Configurations:`);
    for (const config of indexAny.semantic.configurations) {
      console.log(`  - ${config.name}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "show";
  
  console.log("🔧 Azure AI Search Index Manager");
  console.log(`📍 Endpoint: ${AZURE_SEARCH_ENDPOINT}`);
  console.log(`📁 Index: ${INDEX_NAME}`);
  
  switch (command) {
    case "show":
      await showIndexSchema();
      break;
    case "add-langchain-fields":
      await addLangChainFields();
      break;
    default:
      console.log(`
Usage:
  npx tsx add-langchain-fields.ts show                  - Show current index schema
  npx tsx add-langchain-fields.ts add-langchain-fields  - Add LangChain-compatible fields
`);
  }
}

main().catch(console.error);

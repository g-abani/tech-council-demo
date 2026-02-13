import { SearchClient, SearchIndexClient, AzureKeyCredential } from '@azure/search-documents';
import dotenv from 'dotenv';
dotenv.config();

const endpoint = process.env.AZURE_SEARCH_ENDPOINT!;
const apiKey = process.env.AZURE_SEARCH_API_KEY!;
const indexName = 'multimodal-rag-1764420107845';

async function main() {
  // Check field definitions
  const indexClient = new SearchIndexClient(endpoint, new AzureKeyCredential(apiKey));
  const index = await indexClient.getIndex(indexName);
  
  console.log('\n📋 Field Retrievability:');
  for (const field of index.fields) {
    const f = field as any;
    const status = f.hidden === false ? '✅ retrievable' : '❌ hidden';
    console.log(`  ${field.name}: ${status}`);
  }
  
  // Try to retrieve a document
  const searchClient = new SearchClient(endpoint, indexName, new AzureKeyCredential(apiKey));
  
  console.log('\n📝 Testing document retrieval...');
  const results = await searchClient.search('What is Milo?', { 
    select: ['content_id', 'document_title', 'content_path'],
    top: 1 
  });
  
  for await (const r of results.results) {
    console.log('Sample document:', JSON.stringify(r.document, null, 2));
  }
}

main().catch(console.error);


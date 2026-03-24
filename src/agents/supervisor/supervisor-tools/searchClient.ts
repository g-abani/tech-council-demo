import { SearchClient } from "@azure/search-documents";
import { AzureKeyCredential } from "@azure/core-auth";
import { config } from 'dotenv';

config();

let _searchClient: SearchClient<object> | null = null;

export function getSearchClient(): SearchClient<object> {
  if (!_searchClient) {
    const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
    // Match .env.example (AZURE_SEARCH_API_KEY); keep AZURE_SEARCH_KEY as legacy alias
    const key =
      process.env.AZURE_SEARCH_API_KEY || process.env.AZURE_SEARCH_KEY;
    const index = process.env.AZURE_SEARCH_INDEX;

    if (!endpoint || !key || !index) {
      throw new Error(
        "Azure Search is not configured. Set AZURE_SEARCH_ENDPOINT, AZURE_SEARCH_API_KEY (or legacy AZURE_SEARCH_KEY), and AZURE_SEARCH_INDEX in your .env file."
      );
    }

    _searchClient = new SearchClient(endpoint, index, new AzureKeyCredential(key));
  }
  return _searchClient;
}

/** @deprecated Use getSearchClient() instead */
export const searchClient = new Proxy({} as SearchClient<object>, {
  get(_target, prop, receiver) {
    return Reflect.get(getSearchClient(), prop, receiver);
  },
});
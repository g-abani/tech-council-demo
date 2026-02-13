import {
    AzureAISearchVectorStore,
    AzureAISearchQueryType,
  } from "@langchain/community/vectorstores/azure_aisearch";
  import { ChatPromptTemplate } from "@langchain/core/prompts";
  import { AzureOpenAIEmbeddings, ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
  import { createStuffDocumentsChain } from "@langchain/classic/chains/combine_documents";
  import { createRetrievalChain } from "@langchain/classic/chains/retrieval";
  import { TextLoader } from "@langchain/classic/document_loaders/fs/text";
  import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
  import dotenv from "dotenv";
  import { llm } from "../../services/llm.js";
  dotenv.config();

  function createEmbeddings() {
    return new AzureOpenAIEmbeddings({
        azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
        azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
        azureOpenAIApiDeploymentName: 'text-embedding-3-small',
        azureOpenAIApiVersion: '2024-02-01',
    });
}
  // Load documents from file
  const loader = new TextLoader("./src/agents/azureai-vector/state_of_the_union.txt");
  const rawDocuments = await loader.load();
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 0,
  });
  const documents = await splitter.splitDocuments(rawDocuments);
  const embeddings = createEmbeddings();
  // Create Azure AI Search vector store
  const store = await AzureAISearchVectorStore.fromDocuments(
    documents,
    embeddings,
    {
      search: {
        type: AzureAISearchQueryType.SimilarityHybrid,
      },
    }
  );
  
  // The first time you run this, the index will be created.
  // You may need to wait a bit for the index to be created before you can perform
  // a search, or you can create the index manually beforehand.
  
  // Performs a similarity search
  const resultDocuments = await store.similaritySearch(
    "What did the president say about Ketanji Brown Jackson?"
  );
  
  //console.log("Similarity search results:");
  //console.log(resultDocuments[0].pageContent);
  /*
    Tonight. I call on the Senate to: Pass the Freedom to Vote Act. Pass the John Lewis Voting Rights Act. And while you’re at it, pass the Disclose Act so Americans can know who is funding our elections.
  
    Tonight, I’d like to honor someone who has dedicated his life to serve this country: Justice Stephen Breyer—an Army veteran, Constitutional scholar, and retiring Justice of the United States Supreme Court. Justice Breyer, thank you for your service.
  
    One of the most serious constitutional responsibilities a President has is nominating someone to serve on the United States Supreme Court.
  
    And I did that 4 days ago, when I nominated Circuit Court of Appeals Judge Ketanji Brown Jackson. One of our nation’s top legal minds, who will continue Justice Breyer’s legacy of excellence.
  */
  
  // Use the store as part of a chain
  //const model = new ChatOpenAI({ model: "gpt-3.5-turbo-1106" });
  const model = llm;
  const questionAnsweringPrompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      "Answer the user's questions based on the below context:\n\n{context}",
    ],
    ["human", "{input}"],
  ]);
  
  const combineDocsChain = await createStuffDocumentsChain({
    llm: model,
    prompt: questionAnsweringPrompt,
  });
  //console.log("combineDocsChain created ", combineDocsChain);
  const chain = await createRetrievalChain({
    retriever: store.asRetriever() as any,
    combineDocsChain,
  });
  
  const response = await chain.invoke({
    input: "What is the president's top priority regarding prices?",
  });
  
  console.log("Chain response:");
  console.log(response.answer);
  /*
    The president's top priority is getting prices under control.
  */
import { Client } from "@langchain/langgraph-sdk";

async function run() {
  const client = new Client({ apiUrl: "http://localhost:8123" });
  const threads = await client.threads.search({ limit: 2 });
  console.log(JSON.stringify(threads.map(t => ({ id: t.thread_id, metadata: t.metadata })), null, 2));
}

run().catch(console.error);

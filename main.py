import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from parser import clone_and_extract
from database import store_chunks, search_code
from groq import Groq

app = FastAPI(title="DeepCode API")

# Setup CORS Middleware (Ye add karna zaroori hai React frontend ke liye)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Setup Groq Client
client = Groq(api_key="YOUR_GROQ_API_KEY")  # Replace with your actual Groq API key

class RepoRequest(BaseModel):
    url: str

class QueryRequest(BaseModel):
    query: str

@app.post("/ingest")
def ingest_repo(req: RepoRequest):
    chunks = clone_and_extract(req.url)
    count = store_chunks(chunks)
    return {"message": "Success", "chunks_embedded": count}

@app.post("/query")
def ask_codebase(req: QueryRequest):
    search_results = search_code(req.query, n_results=3)
    
    if not search_results["documents"][0]:
        return {"answer": "Codebase mein is query se related kuch nahi mila."}

    retrieved_chunks = search_results["documents"][0]
    context = "\n\n---\n\n".join(retrieved_chunks)
    
    system_prompt = "You are an expert AI coding assistant. Answer the user's question based ONLY on the provided code context. Give a clear, direct, and technical explanation. If the answer is not in the context, say so."
    user_prompt = f"Context (Code):\n{context}\n\nQuestion: {req.query}"
    
    chat_completion = client.chat.completions.create(
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        model="llama-3.3-70b-versatile",
    )
    
    answer = chat_completion.choices[0].message.content
    
    return {
        "answer": answer,
        "source_files_used": search_results["metadatas"][0]
    }
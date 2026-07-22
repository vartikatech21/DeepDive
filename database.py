import chromadb
from sentence_transformers import SentenceTransformer

# Load Local Model (Requires no internet after first download)
model = SentenceTransformer('all-MiniLM-L6-v2')

# Setup Local ChromaDB
chroma_client = chromadb.PersistentClient(path="./chroma_data")
collection = chroma_client.get_or_create_collection(name="code_base")

def store_chunks(chunks: list):
    if not chunks:
        return 0
        
    texts = [chunk["text"] for chunk in chunks]
    metadatas = [{"file": chunk["file"]} for chunk in chunks]
    ids = [f"chunk_{i}" for i in range(len(chunks))]
    
    # Generate vectors
    embeddings = model.encode(texts).tolist()
    
    # Save to ChromaDB
    collection.add(
        documents=texts,
        embeddings=embeddings,
        metadatas=metadatas,
        ids=ids
    )
    return len(chunks)

def search_code(query: str, n_results=3):
    query_vector = model.encode([query]).tolist()
    results = collection.query(
        query_embeddings=query_vector,
        n_results=n_results
    )
    return results
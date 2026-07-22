import React, { useState } from 'react';
import axios from 'axios';

const API_BASE = "http://127.0.0.1:8000";

export default function App() {
  const [repoUrl, setRepoUrl] = useState("");
  const [ingestStatus, setIngestStatus] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleIngest = async (e) => {
    e.preventDefault();
    if (!repoUrl) return;
    setIngestStatus("Cloning and processing repository...");
    try {
      const res = await axios.post(`${API_BASE}/ingest`, { url: repoUrl });
      setIngestStatus(`Success! Embedded ${res.data.chunks_embedded} chunks.`);
    } catch (err) {
      setIngestStatus("Error during ingestion. Check backend terminal.");
    }
  };

  const handleQuery = async (e) => {
    e.preventDefault();
    if (!query) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await axios.post(`${API_BASE}/query`, { query });
      setResult(res.data);
    } catch (err) {
      setResult({ answer: "Error fetching answer from backend." });
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 p-4 bg-slate-900/50 backdrop-blur">
        <h1 className="text-xl font-bold tracking-tight text-cyan-400">DeepCode AI Assistant</h1>
      </header>

      <div className="flex flex-1 flex-col md:flex-row">
        {/* Sidebar for Ingestion */}
        <aside className="w-full md:w-80 border-r border-slate-800 p-6 bg-slate-900/20 flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-slate-200">Ingest Repository</h2>
          <form onSubmit={handleIngest} className="flex flex-col gap-3">
            <input 
              type="text" 
              placeholder="https://github.com/username/repo" 
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
            />
            <button 
              type="submit"
              className="bg-cyan-600 hover:bg-cyan-500 text-white font-medium py-2 rounded-lg text-sm transition"
            >
              Ingest Repo
            </button>
          </form>
          {ingestStatus && <p className="text-xs text-cyan-300 mt-2">{ingestStatus}</p>}
        </aside>

        {/* Main Chat/Query Area */}
        <main className="flex-1 p-6 flex flex-col max-w-4xl mx-auto w-full">
          <form onSubmit={handleQuery} className="flex gap-3 mb-6">
            <input 
              type="text" 
              placeholder="Ask anything about the codebase..." 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:border-cyan-500"
            />
            <button 
              type="submit"
              disabled={loading}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 rounded-xl font-medium transition disabled:opacity-50"
            >
              {loading ? "Thinking..." : "Ask AI"}
            </button>
          </form>

          {/* Results Section */}
          {result && (
            <div className="flex flex-col gap-4 bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">AI Answer</h3>
                <div className="text-slate-200 whitespace-pre-wrap leading-relaxed bg-slate-950/50 p-4 rounded-xl border border-slate-800/60">
                  {result.answer}
                </div>
              </div>

              {result.source_files_used && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Sources</h3>
                  <div className="flex flex-wrap gap-2">
                    {result.source_files_used.map((src, idx) => (
                      <span key={idx} className="bg-slate-800 text-cyan-300 text-xs px-2.5 py-1 rounded-md border border-slate-700">
                        {src.file}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
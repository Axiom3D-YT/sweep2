import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Mail, Trash2, ShieldCheck, RefreshCw, LogOut, AlertCircle, CheckCircle2,
  Sparkles, ArrowRight, User, Play, Pause, Plus, History, Clock,
  ChevronLeft, ChevronRight, Search, Settings, Cpu, Folder, FolderPlus,
  ArrowUpRight, Infinity as InfinityIcon, Eye, Filter, PlayCircle, Calendar,
  LayoutGrid, List, Check, X, Layers
} from "lucide-react";
import { auth, googleProvider, firebaseReady } from "./firebase";
import { 
  signInWithPopup, signOut, onAuthStateChanged, GoogleAuthProvider, UserCredential
} from "firebase/auth";


interface Email {
  id: string;
  uid: string;
  subject: string;
  from: string;
  snippet: string;
  timestamp: string;
  labels: string; 
  isRubbish?: boolean;
  reason?: string;
  selected?: boolean;
  suggestedFolder?: string;
  analyzed: number;
  analyzeCount: number;
}

interface UserStats {
  total: number;
  analyzed: number;
  rubbish: number;
}

export default function App() {
  return <SweepApp />;
}

function SweepApp() {
  const [user, setUser] = useState<any>(null);
  const [accessToken, setAccessToken] = useState<string | null>(() => localStorage.getItem('gmailAccessToken'));
  const [loading, setLoading] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  
  // Stats & Emails
  const [stats, setStats] = useState<UserStats>({ total: 0, analyzed: 0, rubbish: 0 });
  const [processedEmails, setProcessedEmails] = useState<Email[]>([]);
  
  // Pagination
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [pageTokenHistory, setPageTokenHistory] = useState<(string|null)[]>([]);
  
  // Controls
  const [isSyncing, setIsSyncing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  // Settings
  const [localLlmEnabled, setLocalLlmEnabled] = useState(true);
  const [localLlmEndpoint, setLocalLlmEndpoint] = useState(() => localStorage.getItem('localLlmEndpoint') || 'http://localhost:11434/api/generate');
  const [localLlmModel, setLocalLlmModel] = useState(() => localStorage.getItem('localLlmModel') || 'llama3');
  const [demoMode, setDemoMode] = useState(() => localStorage.getItem('demoMode') === 'true');
  const [concurrencyLimit, setConcurrencyLimit] = useState(() => Number(localStorage.getItem('concurrencyLimit')) || 1);
  const [batchSize, setBatchSize] = useState(() => Number(localStorage.getItem('batchSize')) || 10);
  const [promptVariant, setPromptVariant] = useState(() => localStorage.getItem('promptVariant') || 'A');
  const [allowedFolders, setAllowedFolders] = useState("");
  
  // View State
  const [showSettings, setShowSettings] = useState(false);
  const [showDateModal, setShowDateModal] = useState(false);
  const [gmailLabels, setGmailLabels] = useState<any[]>([]);
  const [selectedFolder, setSelectedFolder] = useState('INBOX');

  // Filters
  const [filters, setFilters] = useState({
    search: '',
    sender: '',
    after: '', 
    before: '', 
    status: 'all',
    rubbish: 'all'
  });

  // Refs for loops
  const isSyncingRef = useRef(false);
  const isAnalyzingRef = useRef(false);
  const localLlmEnabledRef = useRef(localLlmEnabled);
  const localLlmEndpointRef = useRef(localLlmEndpoint);
  const localLlmModelRef = useRef(localLlmModel);
  const demoModeRef = useRef(demoMode);
  const concurrencyLimitRef = useRef(concurrencyLimit);
  const batchSizeRef = useRef(batchSize);
  const promptVariantRef = useRef(promptVariant);
  const allowedFoldersRef = useRef(allowedFolders);
  const userRef = useRef(user);
  const accessTokenRef = useRef(accessToken);
  const selectedFolderRef = useRef(selectedFolder);

  useEffect(() => { userRef.current = user; if(user) fetchUserData(user.uid); }, [user]);
  useEffect(() => { accessTokenRef.current = accessToken; }, [accessToken]);
  useEffect(() => { isSyncingRef.current = isSyncing; }, [isSyncing]);
  useEffect(() => { isAnalyzingRef.current = isAnalyzing; }, [isAnalyzing]);
  useEffect(() => { selectedFolderRef.current = selectedFolder; }, [selectedFolder]);
  useEffect(() => {
    localStorage.setItem('localLlmEnabled', String(localLlmEnabled));
    localLlmEnabledRef.current = localLlmEnabled;
  }, [localLlmEnabled]);
  useEffect(() => {
    localStorage.setItem('localLlmEndpoint', localLlmEndpoint);
    localLlmEndpointRef.current = localLlmEndpoint;
  }, [localLlmEndpoint]);
  useEffect(() => {
    localStorage.setItem('localLlmModel', localLlmModel);
    localLlmModelRef.current = localLlmModel;
  }, [localLlmModel]);
  useEffect(() => {
    localStorage.setItem('batchSize', String(batchSize));
    batchSizeRef.current = batchSize;
  }, [batchSize]);
  useEffect(() => {
    localStorage.setItem('promptVariant', promptVariant);
    promptVariantRef.current = promptVariant;
  }, [promptVariant]);
  useEffect(() => { allowedFoldersRef.current = allowedFolders; }, [allowedFolders]);

  const fetchUserData = async (uid: string) => {
    const res = await fetch(`/api/users/${uid}`);
    const data = await res.json();
    if (data.allowed_folders) setAllowedFolders(data.allowed_folders);
  };

  const saveAllowedFolders = async () => {
    if (!user) return;
    await fetch(`/api/users/${user.uid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowedFolders })
    });
  };

  useEffect(() => {
    if (accessToken) {
      localStorage.setItem('gmailAccessToken', accessToken);
      fetchLabels();
    } else {
      localStorage.removeItem('gmailAccessToken');
    }
  }, [accessToken]);

  const fetchLabels = async () => {
    if (!accessToken) return;
    try {
      const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setGmailLabels(data.labels || []);
      } else if (res.status === 401) {
        console.warn("Access token expired or invalid");
        localStorage.removeItem('gmailAccessToken');
        setAccessToken(null);
      }
    } catch (err) { 
      console.error("Failed to fetch labels:", err); 
    }
  };

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    firebaseReady.then(({ auth }) => {
      unsubscribe = onAuthStateChanged(auth, (u) => {
        setUser(u);
        setIsAuthReady(true);
        if (u) {
          fetchStats(u.uid);
          fetchLiveEmails(null);
        }
      });
    });
    return () => unsubscribe?.();
  }, []);

  // Reset pagination when folder or filters change
  useEffect(() => {
    if (user && accessToken) {
      setNextPageToken(null);
      setPageTokenHistory([]);
      const timer = setTimeout(() => fetchLiveEmails(null), 500);
      return () => clearTimeout(timer);
    }
  }, [filters, user, selectedFolder]);

  const fetchStats = async (uid: string) => {
    try {
      const res = await fetch(`/api/stats/${uid}`);
      const data = await res.json();
      setStats(data);
    } catch (e) {}
  };

  const fetchingRef = useRef(false);

  const fetchLiveEmails = async (pageToken: string | null = null) => {
    if (!accessToken || !user || fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);
    try {
      const uid = user.uid;
      const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
      url.searchParams.append("maxResults", "50");
      url.searchParams.append("labelIds", selectedFolder);
      if (pageToken) url.searchParams.append("pageToken", pageToken);

      let q = "";
      if (filters.search) q += `${filters.search} `;
      if (filters.sender) q += `from:${filters.sender} `;
      if (filters.after) q += `after:${filters.after.replace(/-/g, "/")} `;
      if (filters.before) q += `before:${filters.before.replace(/-/g, "/")} `;
      if (q) url.searchParams.append("q", q.trim());

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!response.ok) {
        if (response.status === 401) setAccessToken(null);
        return;
      }

      const data = await response.json();
      const messages = data.messages || [];
      setNextPageToken(data.nextPageToken || null);

      // Chunked metadata fetching (10 at a time) to avoid 429
      const validDetails: Email[] = [];
      const chunkSize = 10;
      for (let i = 0; i < messages.length; i += chunkSize) {
        const chunk = messages.slice(i, i + chunkSize);
        const chunkDetails = await Promise.all(chunk.map(async (msg: any) => {
          const mUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`);
          mUrl.searchParams.append("format", "metadata");
          mUrl.searchParams.append("metadataHeaders", "Subject");
          mUrl.searchParams.append("metadataHeaders", "From");
          mUrl.searchParams.append("metadataHeaders", "Date");

          const mRes = await fetch(mUrl.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
          if (!mRes.ok) return null;
          const detail = await mRes.json();
          const headers = detail.payload?.headers;
          return {
            id: msg.id, uid,
            subject: headers?.find((h: any) => h.name === "Subject")?.value || "(No Subject)",
            from: headers?.find((h: any) => h.name === "From")?.value || "(Unknown)",
            snippet: detail.snippet || "",
            timestamp: headers?.find((h: any) => h.name === "Date")?.value ? new Date(headers?.find((h: any) => h.name === "Date")?.value).toISOString() : new Date().toISOString(),
            labels: selectedFolder,
            analyzed: 0, analyzeCount: 0
          };
        }));
        validDetails.push(...(chunkDetails.filter(Boolean) as Email[]));
        if (i + chunkSize < messages.length) await new Promise(r => setTimeout(r, 200)); // Small pause
      }

      // Lookup existing analysis from local DB
      const lookupRes = await fetch("/api/emails/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: validDetails.map(d => d.id) })
      });
      const dbInfo = await lookupRes.json();

      const merged = validDetails.map(ld => {
        const dbEntry = dbInfo.find((di: any) => di.id === ld.id);
        return dbEntry ? { ...ld, ...dbEntry } : ld;
      });

      setProcessedEmails(merged);

      fetch("/api/emails/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: validDetails })
      }).catch(() => {});

    } catch (err) {
      console.error("Live fetch error:", err);
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  };

  const handleNextPage = () => {
    if (nextPageToken) {
      setPageTokenHistory([...pageTokenHistory, nextPageToken]);
      fetchLiveEmails(nextPageToken);
    }
  };

  const handlePrevPage = () => {
    const newHistory = [...pageTokenHistory];
    newHistory.pop(); // Remove current token
    const prevToken = newHistory.length > 0 ? newHistory[newHistory.length - 1] : null;
    setPageTokenHistory(newHistory);
    fetchLiveEmails(prevToken);
  };

  const toggleSync = () => {
    const next = !isSyncing;
    setIsSyncing(next);
    if (next) runLiveSync();
  };

  const toggleAnalysis = () => {
    const next = !isAnalyzing;
    setIsAnalyzing(next);
    if (next) runAnalysisLoop();
  };

  const runLiveSync = async () => {
    while (isSyncingRef.current) {
      try {
        if (!userRef.current || !accessTokenRef.current) { setIsSyncing(false); break; }
        const uid = userRef.current.uid;
        const token = accessTokenRef.current;
        const folder = selectedFolderRef.current;

        const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
        url.searchParams.append("maxResults", "100");
        url.searchParams.append("labelIds", folder);

        const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) { if (response.status === 401) setAccessToken(null); break; }

        const data = await response.json();
        const messages = data.messages || [];
        if (messages.length > 0) await processMessagesBatch(messages, uid, token, folder);

        fetchStats(uid);
        await new Promise(r => setTimeout(r, 15000));
      } catch (err) { await new Promise(r => setTimeout(r, 60000)); }
    }
  };

  const processMessagesBatch = async (messages: any[], uid: string, token: string, folder: string) => {
    const details: any[] = [];
    const internalBatchSize = 25;
    for (let i = 0; i < messages.length; i += internalBatchSize) {
      if (!isSyncingRef.current) break;
      const batch = messages.slice(i, i + internalBatchSize);
      const batchDetails = await Promise.all(batch.map(async (msg: any) => {
        const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`);
        url.searchParams.append("format", "metadata");
        url.searchParams.append("metadataHeaders", "Subject");
        url.searchParams.append("metadataHeaders", "From");
        url.searchParams.append("metadataHeaders", "Date");

        const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return null;
        const detail = await res.json();
        const headers = detail.payload?.headers;
        return {
          id: msg.id, uid,
          subject: headers?.find((h: any) => h.name === "Subject")?.value || "(No Subject)",
          from: headers?.find((h: any) => h.name === "From")?.value || "(Unknown)",
          snippet: detail.snippet || "",
          timestamp: headers?.find((h: any) => h.name === "Date")?.value ? new Date(headers?.find((h: any) => h.name === "Date")?.value).toISOString() : new Date().toISOString(),
          labels: folder,
          analyzed: 0, analyzeCount: 0, createdAt: new Date().toISOString()
        };
      }));
      details.push(...batchDetails.filter(Boolean));
      if (details.length >= internalBatchSize) {
        await fetch("/api/emails/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emails: details.splice(0, details.length) })
        });
      }
    }
  };

  const runAnalysisLoop = async () => {
    while (isAnalyzingRef.current) {
      try {
        if (!userRef.current) { setIsAnalyzing(false); break; }
        const uid = userRef.current.uid;
        const limit = concurrencyLimitRef.current;
        const size = batchSizeRef.current;
        
        const res = await fetch(`/api/emails/pending/${uid}?limit=${limit * size}&folder=${selectedFolder}`);
        const pending = await res.json();
        if (pending.length === 0) { await new Promise(r => setTimeout(r, 10000)); continue; }

        const promptRes = await fetch(`/api/prompts/${size}/${promptVariantRef.current}`);
        const { content: promptTemplate } = await promptRes.json();

        const batches = [];
        for (let i = 0; i < pending.length; i += size) {
          batches.push(pending.slice(i, i + size));
        }

        await Promise.all(batches.map(async (batch) => {
          const results = await executeBatchAnalysis(batch, promptTemplate);
          if (!demoModeRef.current) {
            for (const r of results) {
              await fetch(`/api/emails/${r.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...r, analyzed: true, analyzeCount: (r.analyzeCount || 0) + 1 })
              });
            }
          }

          // FIX: Update state with actual analysis results
          setProcessedEmails(prev => prev.map(pe => {
            const result = results.find((r: any) => r.id === pe.id);
            if (result) {
              return { ...pe, ...result, analyzed: 1, analyzeCount: (pe.analyzeCount || 0) + 1 };
            }
            return pe;
          }));
        }));

        fetchStats(uid);
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) { setIsAnalyzing(false); break; }
    }
  };

  const executeBatchAnalysis = async (batch: any[], promptTemplate: string) => {
    const prompt = promptTemplate
      .replace("{{currentDate}}", new Date().toLocaleDateString())
      .replace("{{batchSize}}", batch.length.toString())
      .replace("{{allowedFolders}}", allowedFoldersRef.current || "None set")
      .replace("{{emailData}}", JSON.stringify(batch.map(e => ({
        id: e.id, subject: e.subject, from: e.from, snippet: e.snippet, date: new Date(e.timestamp).toLocaleDateString()
      })), null, 2));

    let results: any[] = [];

    try {
      let endpoint = localLlmEndpointRef.current;
      let model = localLlmModelRef.current;

      if (!endpoint || !model) {
        const configRes = await fetch("/api/config");
        const config = await configRes.json();
        endpoint = endpoint || config.localLlm?.endpoint || "";
        model = model || config.localLlm?.model || "";
      }

      if (!endpoint || !model) {
        throw new Error("Local LLM (required) is not configured. Set endpoint and model in Settings or server env.");
      }

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint,
          body: { model, prompt: prompt + "\n\nReturn JSON array.", stream: false, format: "json" }
        })
      });
      const data = await response.json();
      const text = data.content || data.response || data.message?.content || data.choices?.[0]?.message?.content || "";

      // Robust JSON extraction: Find the first [ and last ]
      const start = text.indexOf('[');
      const end = text.lastIndexOf(']') + 1;
      if (start !== -1 && end !== -1) {
        results = JSON.parse(text.substring(start, end));
      } else {
        // Try parsing the whole thing if no brackets found
        results = JSON.parse(text);
      }
    } catch (e) { 
      console.error("LLM parsing error:", e);
      results = []; 
    }

    return batch.map(e => {
      const r = Array.isArray(results) ? results.find((res: any) => res.id === e.id) : null;
      return { ...e, isRubbish: !!r?.isRubbish, reason: r?.reason || "Analysis failed", suggestedFolder: r?.suggestedFolder || "" };
    });
  };

  const manualAnalyze = async (email: any) => {
    const promptRes = await fetch(`/api/prompts/1/${promptVariant}`);
    const { content } = await promptRes.json();
    const results = await executeBatchAnalysis([email], content);
    if (results.length > 0 && !demoModeRef.current) {
      const r = results[0];
      await fetch(`/api/emails/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...r, analyzed: true, analyzeCount: (email.analyzeCount || 0) + 1 })
      });
      setProcessedEmails(prev => prev.map(ev => ev.id === email.id ? { ...ev, ...r, analyzed: 1, analyzeCount: (email.analyzeCount || 0) + 1 } : ev));
      fetchStats(user.uid);
    }
  };

  const handleConnect = async () => {
    try {
      const result: UserCredential = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        setAccessToken(credential.accessToken);
        await fetch("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: result.user.uid, email: result.user.email, lastLogin: new Date().toISOString() }) });
        fetchStats(result.user.uid);
        fetchLiveEmails(null);
      }
    } catch (err) {}
  };

  const handleLogout = async () => { await signOut(auth); setAccessToken(null); setProcessedEmails([]); setIsSyncing(false); setIsAnalyzing(false); };

  if (!isAuthReady) return <div className="min-h-screen bg-zinc-950 flex items-center justify-center"><RefreshCw className="w-8 h-8 text-emerald-500 animate-spin" /></div>;

  if (!user || !accessToken) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-6">
        <Mail className="w-20 h-20 text-emerald-500 mb-8" />
        <h1 className="text-5xl font-black uppercase italic mb-4">Sweep</h1>
        <button onClick={handleConnect} className="py-4 px-8 bg-white text-zinc-950 rounded-2xl font-black uppercase flex items-center gap-4 hover:scale-105 transition-all">
          <ShieldCheck className="w-6 h-6" /> Connect Gmail
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      <header className="border-b border-zinc-900 bg-zinc-950/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center"><Mail className="w-5 h-5 text-zinc-950" /></div>
            <span className="font-black text-xl italic uppercase hidden sm:block">Sweep</span>
          </div>

          <div className="flex-1 flex items-center gap-2 max-w-xl">
            <button onClick={toggleSync} className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 transition-all ${isSyncing ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/50' : 'bg-zinc-900 text-zinc-400'}`}>
              {isSyncing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Sync
            </button>
            <button onClick={toggleAnalysis} className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 transition-all ${isAnalyzing ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/50' : 'bg-zinc-900 text-zinc-400'}`}>
              {isAnalyzing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} AI
            </button>
            <div className="h-6 w-px bg-zinc-800 mx-2" />
            <div className="flex items-center gap-4 text-[10px] font-bold text-zinc-500 whitespace-nowrap">
              <span>{stats.total} Total</span>
              <span className="text-emerald-500">{stats.analyzed} Analyzed</span>
              <span className="text-red-500">{stats.rubbish} Rubbish</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-2 py-1 bg-zinc-900 rounded-lg border border-zinc-800">
              <span className={`text-[10px] font-black uppercase ${demoMode ? 'text-amber-500' : 'text-zinc-600'}`}>Demo</span>
              <button onClick={() => setDemoMode(!demoMode)} className={`w-6 h-3 rounded-full relative ${demoMode ? 'bg-amber-500' : 'bg-zinc-700'}`}>
                <div className={`absolute top-0.5 w-2 h-2 bg-white rounded-full transition-all ${demoMode ? 'left-3.5' : 'left-0.5'}`} />
              </button>
            </div>
            <button onClick={() => setShowSettings(true)} className="p-2 hover:bg-zinc-900 rounded-lg"><Settings className="w-4 h-4" /></button>
            <button onClick={handleLogout} className="p-2 hover:bg-red-500/10 text-zinc-500"><LogOut className="w-4 h-4" /></button>
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto flex">
        <aside className="w-64 border-r border-zinc-900 p-4 space-y-6 hidden lg:block sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto custom-scrollbar">
          <div className="space-y-2">
            <h3 className="text-[10px] font-black uppercase text-zinc-500 tracking-widest px-2">Folders</h3>
            <div className="space-y-1">
              {['INBOX', 'TRASH', 'SPAM', 'SENT'].map(f => (
                <button key={f} onClick={() => setSelectedFolder(f)} className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-all ${selectedFolder === f ? 'bg-emerald-500/10 text-emerald-500' : 'hover:bg-zinc-900 text-zinc-400'}`}>
                  {f}
                </button>
              ))}
              <div className="h-px bg-zinc-900 my-2" />
              {gmailLabels.filter(l => l.type === 'user').map(l => (
                <button key={l.id} onClick={() => setSelectedFolder(l.id)} className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-all ${selectedFolder === l.id ? 'bg-emerald-500/10 text-emerald-500' : 'hover:bg-zinc-900 text-zinc-400'}`}>
                  {l.name}
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className="flex-1 p-4 lg:p-8 space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
              <input id="search-box" name="search" type="text" placeholder="Search..." value={filters.search} onChange={e => setFilters({...filters, search: e.target.value})} className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl pl-10 pr-4 py-2 text-sm focus:border-emerald-500 outline-none" />
            </div>
            <button onClick={() => setShowDateModal(true)} className={`px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-sm font-bold flex items-center gap-2 ${ (filters.after || filters.before) ? 'text-emerald-500 border-emerald-500/50' : 'text-zinc-400' }`}>
              <Calendar className="w-4 h-4" /> { (filters.after || filters.before) ? 'Date Filter Active' : 'Date Range' }
            </button>
          </div>

          <div className="grid gap-3 min-h-[400px]">
            {loading ? (
              <div className="flex items-center justify-center py-20"><RefreshCw className="w-8 h-8 text-emerald-500 animate-spin" /></div>
            ) : (
              <AnimatePresence mode="popLayout">
                {processedEmails.map(email => (
                  <motion.div key={email.id} layout initial={{opacity:0}} animate={{opacity:1}} className={`p-4 rounded-2xl border transition-all ${email.selected ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-zinc-900/30 border-zinc-800 hover:border-zinc-700'}`}>
                    <div className="flex items-start gap-4">
                      <button onClick={() => setProcessedEmails(prev => prev.map(ev => ev.id === email.id ? {...ev, selected: !ev.selected} : ev))} className={`w-5 h-5 rounded border-2 flex-shrink-0 transition-all ${email.selected ? 'bg-emerald-500 border-emerald-500' : 'border-zinc-800'}`}>
                        {email.selected && <Check className="w-3 h-3 text-zinc-950" />}
                      </button>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-xs font-black text-zinc-500 truncate">{email.from}</span>
                          <span className="text-[10px] font-bold text-zinc-600 whitespace-nowrap">{new Date(email.timestamp).toLocaleDateString()}</span>
                        </div>
                        <h4 className="font-bold text-sm truncate">{email.subject}</h4>
                        <p className="text-xs text-zinc-500 line-clamp-1">{email.snippet}</p>
                        {email.reason && (
                          <div className="mt-2 p-2 bg-zinc-950/50 rounded-lg border border-zinc-800/50 text-[10px] italic text-zinc-400">
                            <span className="font-black text-emerald-500 uppercase mr-2">AI:</span> {email.reason}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-2">
                        <button onClick={() => manualAnalyze(email)} className="p-2 bg-zinc-900 hover:bg-zinc-800 rounded-lg border border-zinc-800 transition-all" title="Manual Analyze">
                          {email.analyzed ? <RefreshCw className={`w-3 h-3 text-zinc-500`} /> : <PlayCircle className="w-3 h-3 text-emerald-500" />}
                        </button>
                        {email.analyzeCount > 0 && <span className="text-[8px] font-black text-zinc-700 text-center">{email.analyzeCount}x</span>}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>

          <div className="flex items-center justify-center gap-4 py-8">
            <button disabled={pageTokenHistory.length === 0 || loading} onClick={handlePrevPage} className="p-2 bg-zinc-900 border border-zinc-800 rounded-xl disabled:opacity-30 hover:bg-zinc-800 transition-all"><ChevronLeft className="w-5 h-5" /></button>
            <span className="text-[10px] font-black uppercase text-zinc-500">Page {pageTokenHistory.length + 1}</span>
            <button disabled={!nextPageToken || loading} onClick={handleNextPage} className="p-2 bg-zinc-900 border border-zinc-800 rounded-xl disabled:opacity-30 hover:bg-zinc-800 transition-all"><ChevronRight className="w-5 h-5" /></button>
          </div>
        </main>
      </div>

      <AnimatePresence>
        {showDateModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm">
            <motion.div initial={{scale:0.9}} animate={{scale:1}} className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-6">
              <h3 className="font-black uppercase italic">Select Date Range</h3>
              <div className="space-y-4">
                <div className="space-y-1">
                  <label htmlFor="date-after" className="text-[10px] font-black uppercase text-zinc-500">Sent After</label>
                  <input id="date-after" type="date" value={filters.after} onChange={e => setFilters({...filters, after: e.target.value})} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-sm outline-none" />
                </div>
                <div className="space-y-1">
                  <label htmlFor="date-before" className="text-[10px] font-black uppercase text-zinc-500">Sent Before</label>
                  <input id="date-before" type="date" value={filters.before} onChange={e => setFilters({...filters, before: e.target.value})} className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-sm outline-none" />
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setFilters({...filters, after: '', before: ''}); setShowDateModal(false); }} className="flex-1 py-3 bg-zinc-800 rounded-xl text-xs font-black uppercase">Clear</button>
                <button onClick={() => setShowDateModal(false)} className="flex-1 py-3 bg-emerald-500 text-zinc-950 rounded-xl text-xs font-black uppercase">Apply</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm">
            <motion.div initial={{scale:0.9, y:20}} animate={{scale:1, y:0}} className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-[32px] p-8 space-y-8 overflow-y-auto max-h-[90vh] custom-scrollbar">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-black uppercase italic">Settings</h2>
                <button onClick={() => { saveAllowedFolders(); setShowSettings(false); }}><X className="w-6 h-6" /></button>
              </div>

              <div className="space-y-6">
                <div className="p-6 bg-zinc-950 rounded-2xl border border-zinc-800 space-y-4">
                  <div className="flex items-center gap-3"><Layers className="w-5 h-5 text-emerald-500" /><h4 className="font-bold">AI Processing</h4></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label htmlFor="batch-size" className="text-[10px] font-black uppercase text-zinc-500">Batch Size</label>
                      <select id="batch-size" value={batchSize} onChange={e => setBatchSize(Number(e.target.value))} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs">
                        {[1, 10, 25, 50, 100].map(s => <option key={s} value={s}>{s} Emails</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="prompt-variant" className="text-[10px] font-black uppercase text-zinc-500">Prompt Variant</label>
                      <select id="prompt-variant" value={promptVariant} onChange={e => setPromptVariant(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs">
                        {['A', 'B', 'C', 'D'].map(v => <option key={v} value={v}>Variant {v}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="allowed-folders" className="text-[10px] font-black uppercase text-zinc-500">Suggestible Folders (Comma Separated)</label>
                    <input id="allowed-folders" type="text" value={allowedFolders} onChange={e => setAllowedFolders(e.target.value)} placeholder="Work, Finance, Personal..." className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-xs outline-none focus:border-emerald-500" />
                  </div>
                </div>

                <div className="p-6 bg-zinc-950 rounded-2xl border border-zinc-800 space-y-4">
                  <div className="flex items-center gap-3"><Cpu className="w-5 h-5 text-emerald-500" /><h4 className="font-bold">Local LLM (required)</h4></div>
                  <input id="llm-endpoint" type="text" value={localLlmEndpoint} onChange={e => setLocalLlmEndpoint(e.target.value)} placeholder="Endpoint URL" className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-xs outline-none" />
                  <input id="llm-model" type="text" value={localLlmModel} onChange={e => setLocalLlmModel(e.target.value)} placeholder="Model Name" className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-xs outline-none" />
                </div>
              </div>

              <button onClick={() => { saveAllowedFolders(); setShowSettings(false); }} className="w-full py-4 bg-white text-zinc-950 rounded-2xl font-black uppercase tracking-widest">Save & Close</button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

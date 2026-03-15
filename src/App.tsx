import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Mail, 
  Trash2, 
  ShieldCheck, 
  RefreshCw, 
  LogOut, 
  AlertCircle, 
  CheckCircle2,
  Sparkles,
  ArrowRight,
  User,
  Play,
  Pause,
  Plus,
  History,
  Clock,
  ChevronLeft,
  ChevronRight,
  Search,
  Settings,
  Cpu,
  Folder,
  FolderPlus,
  ArrowUpRight,
  Infinity as InfinityIcon
} from "lucide-react";
import { GoogleGenAI } from "@google/genai";
import { auth, googleProvider, db } from "./firebase";
import { 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  GoogleAuthProvider,
  UserCredential
} from "firebase/auth";
import { 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  query, 
  where, 
  getDocs, 
  orderBy, 
  limit, 
  startAfter,
  addDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
  writeBatch
} from "firebase/firestore";

// We'll allow toggling between Local Run (SQLite + Local LLM) and Cloud Run (Firestore + Gemini)

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface Email {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  timestamp: string;
  isRubbish?: boolean;
  reason?: string;
  selected?: boolean;
  suggestedFolder?: string;
}

interface SweepJob {
  id: string;
  uid: string;
  status: 'running' | 'paused' | 'completed';
  download_status: 'idle' | 'running' | 'paused' | 'completed';
  analysis_status: 'idle' | 'running' | 'paused' | 'completed';
  lastPageToken?: string;
  processedCount: number;
  analyzedCount: number;
  rubbishCount: number;
  createdAt: string;
  updatedAt: string;
  lastSyncTimestamp?: string;
}

export default function App() {
  return <SweepApp />;
}

function SweepApp() {
  const [user, setUser] = useState<any>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  
  // Job System State
  const [activeJob, setActiveJob] = useState<SweepJob | null>(null);
  const [availableJobs, setAvailableJobs] = useState<SweepJob[]>([]);
  const [showJobSelector, setShowJobSelector] = useState(true);
  const [processedEmails, setProcessedEmails] = useState<Email[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [analysisStartTime, setAnalysisStartTime] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [isStoppingDownload, setIsStoppingDownload] = useState(false);
  const [isStoppingAnalysis, setIsStoppingAnalysis] = useState(false);
  const [localLlmEnabled, setLocalLlmEnabled] = useState(() => localStorage.getItem('localLlmEnabled') === 'true');
  const [localLlmEndpoint, setLocalLlmEndpoint] = useState(() => localStorage.getItem('localLlmEndpoint') || 'http://localhost:11434/api/generate');
  const [localLlmModel, setLocalLlmModel] = useState(() => localStorage.getItem('localLlmModel') || 'llama3');
  const [localLlmApiKey, setLocalLlmApiKey] = useState(() => localStorage.getItem('localLlmApiKey') || '');
  const [localRun, setLocalRun] = useState(() => localStorage.getItem('localRun') !== 'false'); // Default to true
  const [disableTimeLimit, setDisableTimeLimit] = useState(() => localStorage.getItem('disableTimeLimit') === 'true');
  const [showSettings, setShowSettings] = useState(false);
  const [gmailLabels, setGmailLabels] = useState<any[]>([]);

  const downloadingRef = React.useRef(false);
  const analyzingRef = React.useRef(false);
  const isStoppingDownloadRef = React.useRef(false);
  const isStoppingAnalysisRef = React.useRef(false);
  const localLlmEnabledRef = React.useRef(localLlmEnabled);
  const localLlmEndpointRef = React.useRef(localLlmEndpoint);
  const localLlmModelRef = React.useRef(localLlmModel);
  const localLlmApiKeyRef = React.useRef(localLlmApiKey);
  const localRunRef = React.useRef(localRun);
  const disableTimeLimitRef = React.useRef(disableTimeLimit);

  useEffect(() => {
    localStorage.setItem('localRun', String(localRun));
    localRunRef.current = localRun;
  }, [localRun]);

  useEffect(() => {
    localStorage.setItem('localLlmApiKey', localLlmApiKey);
    localLlmApiKeyRef.current = localLlmApiKey;
  }, [localLlmApiKey]);

  useEffect(() => {
    downloadingRef.current = downloading;
  }, [downloading]);

  useEffect(() => {
    analyzingRef.current = analyzing;
  }, [analyzing]);

  useEffect(() => {
    isStoppingDownloadRef.current = isStoppingDownload;
  }, [isStoppingDownload]);

  useEffect(() => {
    isStoppingAnalysisRef.current = isStoppingAnalysis;
  }, [isStoppingAnalysis]);

  useEffect(() => {
    localLlmEnabledRef.current = localLlmEnabled;
    localStorage.setItem('localLlmEnabled', String(localLlmEnabled));
  }, [localLlmEnabled]);

  useEffect(() => {
    localLlmEndpointRef.current = localLlmEndpoint;
    localStorage.setItem('localLlmEndpoint', localLlmEndpoint);
  }, [localLlmEndpoint]);

  useEffect(() => {
    localLlmModelRef.current = localLlmModel;
    localStorage.setItem('localLlmModel', localLlmModel);
  }, [localLlmModel]);

  useEffect(() => {
    disableTimeLimitRef.current = disableTimeLimit;
    localStorage.setItem('disableTimeLimit', String(disableTimeLimit));
  }, [disableTimeLimit]);

  useEffect(() => {
    if (accessToken) {
      fetchLabels();
    }
  }, [accessToken]);

  const fetchLabels = async () => {
    try {
      const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setGmailLabels(data.labels || []);
      }
    } catch (err) {
      console.error("Failed to fetch labels", err);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setIsAuthReady(true);
      if (user) {
        loadAvailableJobs(user.uid);
      } else {
        setAccessToken(null);
        setEmails([]);
        setAvailableJobs([]);
        setActiveJob(null);
      }
    });
    return () => unsubscribe();
  }, []);

  const loadAvailableJobs = async (uid: string) => {
    try {
      if (localRunRef.current) {
        const res = await fetch(`/api/jobs/${uid}`);
        const jobs = await res.json();
        setAvailableJobs(jobs);
      } else {
        const q = query(collection(db, "jobs"), where("uid", "==", uid), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        setAvailableJobs(snap.docs.map(d => ({ id: d.id, ...d.data() } as SweepJob)));
      }
    } catch (err) {
      console.error("Failed to load jobs", err);
    }
  };

  const createNewJob = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const newJob: SweepJob = {
        id: Math.random().toString(36).substring(2, 15),
        uid: user.uid,
        status: 'paused',
        download_status: 'idle',
        analysis_status: 'idle',
        processedCount: 0,
        analyzedCount: 0,
        rubbishCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      if (localRunRef.current) {
        await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newJob)
        });
      } else {
        await setDoc(doc(db, "jobs", newJob.id), newJob);
      }
      
      setActiveJob(newJob);
      setShowJobSelector(false);
      setProcessedEmails([]);
      setCurrentPage(1);
      setHasMore(false);
    } catch (err) {
      setError("Failed to create new job");
    } finally {
      setLoading(false);
    }
  };

  const continueJob = async (job: SweepJob) => {
    setActiveJob(job);
    setShowJobSelector(false);
    fetchProcessedEmails(job.id);
  };

  const fetchProcessedEmails = async (jobId: string, next = false) => {
    setLoading(true);
    try {
      const offset = next ? processedEmails.length : 0;
      let emails: Email[] = [];
      
      if (localRunRef.current) {
        const res = await fetch(`/api/emails/${jobId}?uid=${user?.uid}&limit=100&offset=${offset}`);
        emails = await res.json();
      } else {
        const q = query(
          collection(db, "emails"), 
          where("jobId", "==", jobId), 
          where("uid", "==", user?.uid),
          orderBy("createdAt", "desc"),
          limit(100)
        );
        const snap = await getDocs(q);
        emails = snap.docs.map(d => ({ id: d.id, ...d.data() } as Email));
      }
      
      if (next) {
        setProcessedEmails(prev => [...prev, ...emails]);
        setCurrentPage(prev => prev + 1);
      } else {
        setProcessedEmails(emails);
        setCurrentPage(1);
      }

      setHasMore(emails.length === 100);
    } catch (err) {
      setError("Failed to load processed emails");
    } finally {
      setLoading(false);
    }
  };

  const moveEmailsToFolder = async (emailIds: string[], folderName: string) => {
    if (!accessToken) return;
    setCleaning(true);
    try {
      // 1. Find or create label
      let labelId = gmailLabels.find(l => l.name === folderName)?.id;
      if (!labelId) {
        const createRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
          method: "POST",
          headers: { 
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            name: folderName,
            labelListVisibility: "labelShow",
            messageListVisibility: "show"
          })
        });
        if (createRes.ok) {
          const newLabel = await createRes.json();
          labelId = newLabel.id;
          setGmailLabels(prev => [...prev, newLabel]);
        } else {
          throw new Error("Failed to create label");
        }
      }

      // 2. Batch move (add label, remove INBOX)
      const batchSize = 50;
      for (let i = 0; i < emailIds.length; i += batchSize) {
        const batch = emailIds.slice(i, i + batchSize);
        await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify", {
          method: "POST",
          headers: { 
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            ids: batch,
            addLabelIds: [labelId],
            removeLabelIds: ["INBOX"]
          })
        });
      }

      // 3. Update local state
      setProcessedEmails(prev => prev.filter(e => !emailIds.includes(e.id)));
      setError(null);
    } catch (err) {
      console.error("Failed to move emails", err);
      setError("Failed to move emails to folder.");
    } finally {
      setCleaning(false);
    }
  };

  const handleConnect = async () => {
    setError(null);
    try {
      const result: UserCredential = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const token = credential?.accessToken;
      
      if (token) {
        setAccessToken(token);
        if (localRunRef.current) {
          await fetch("/api/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: result.user.uid,
              email: result.user.email,
              lastLogin: new Date().toISOString()
            })
          });
        } else {
          await setDoc(doc(db, "users", result.user.uid), {
            uid: result.user.uid,
            email: result.user.email,
            lastLogin: new Date().toISOString()
          }, { merge: true });
        }
      } else {
        throw new Error("Failed to get access token from Google login.");
      }
    } catch (err: any) {
      console.error("Login failed", err);
      setError("Login failed: " + (err.message || "Unknown error"));
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setAccessToken(null);
    setEmails([]);
    setActiveJob(null);
    setShowJobSelector(true);
  };

  const startDownload = async (job?: SweepJob) => {
    const targetJob = job || activeJob;
    if (!targetJob || !accessToken) return;
    setDownloading(true);
    setIsStoppingDownload(false);
    
    if (localRunRef.current) {
      await fetch(`/api/jobs/${targetJob.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ download_status: 'running', updatedAt: new Date().toISOString() })
      });
    } else {
      await updateDoc(doc(db, "jobs", targetJob.id), {
        download_status: 'running',
        updatedAt: serverTimestamp()
      });
    }
    setActiveJob(prev => prev ? { ...prev, download_status: 'running' } : null);

    runDownloadLoop(targetJob.id, targetJob.lastPageToken);
  };

  const stopDownload = async () => {
    setIsStoppingDownload(true);
  };

  const startAnalysis = async () => {
    if (!activeJob) return;
    setAnalyzing(true);
    setIsStoppingAnalysis(false);
    
    if (localRunRef.current) {
      await fetch(`/api/jobs/${activeJob.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis_status: 'running', updatedAt: new Date().toISOString() })
      });
    } else {
      await updateDoc(doc(db, "jobs", activeJob.id), {
        analysis_status: 'running',
        updatedAt: serverTimestamp()
      });
    }
    setActiveJob(prev => prev ? { ...prev, analysis_status: 'running' } : null);

    runAnalysisLoop(activeJob.id);
  };

  const stopAnalysis = async () => {
    setIsStoppingAnalysis(true);
  };

  const runDownloadLoop = async (jobId: string, pageToken?: string) => {
    let currentToken = pageToken;
    const startTime = Date.now();
    const MAX_DURATION = 30 * 60 * 1000;

    while (true) {
      const timeLimitReached = !disableTimeLimitRef.current && (Date.now() - startTime > MAX_DURATION);
      if (isStoppingDownloadRef.current || timeLimitReached) {
        if (localRunRef.current) {
          await fetch(`/api/jobs/${jobId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              download_status: 'paused', 
              lastPageToken: currentToken,
              updatedAt: new Date().toISOString() 
            })
          });
        } else {
          await updateDoc(doc(db, "jobs", jobId), {
            download_status: 'paused',
            lastPageToken: currentToken || null,
            updatedAt: serverTimestamp()
          });
        }
        setActiveJob(prev => prev ? { ...prev, download_status: 'paused', lastPageToken: currentToken } : null);
        setDownloading(false);
        break;
      }

      try {
        const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
        url.searchParams.append("maxResults", "50");
        
        let queryStr = "label:INBOX";
        if (activeJob?.lastSyncTimestamp) {
          const unixTime = Math.floor((new Date(activeJob.lastSyncTimestamp).getTime() - 3600000) / 1000);
          queryStr += ` after:${unixTime}`;
        }
        url.searchParams.append("q", queryStr);
        if (currentToken) url.searchParams.append("pageToken", currentToken);

        const response = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (!response.ok) throw new Error("Gmail API error");
        const data = await response.json();
        const messages = data.messages || [];
        currentToken = data.nextPageToken;

        if (messages.length === 0) {
          const now = new Date().toISOString();
          if (localRunRef.current) {
            await fetch(`/api/jobs/${jobId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ 
                download_status: 'completed', 
                lastSyncTimestamp: now,
                updatedAt: now 
              })
            });
          } else {
            await updateDoc(doc(db, "jobs", jobId), {
              download_status: 'completed',
              lastSyncTimestamp: serverTimestamp(),
              updatedAt: serverTimestamp()
            });
          }
          setActiveJob(prev => prev ? { ...prev, download_status: 'completed', lastSyncTimestamp: now } : null);
          setDownloading(false);
          break;
        }

        const details: any[] = [];
        const detailBatchSize = 10;
        for (let i = 0; i < messages.length; i += detailBatchSize) {
          const batch = messages.slice(i, i + detailBatchSize);
          const batchDetails = await Promise.all(
            batch.map(async (msg: any) => {
              const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`, {
                headers: { Authorization: `Bearer ${accessToken}` }
              });
              if (!res.ok) return null;
              const detail = await res.json();
              const headers = detail.payload?.headers;
              const subject = headers?.find((h: any) => h.name === "Subject")?.value || "(No Subject)";
              const from = headers?.find((h: any) => h.name === "From")?.value || "(Unknown)";
              const dateHeader = headers?.find((h: any) => h.name === "Date")?.value;
              return {
                id: msg.id,
                jobId,
                uid: user?.uid,
                subject,
                from,
                snippet: detail.snippet || "",
                timestamp: dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString(),
                analyzed: 0,
                createdAt: new Date().toISOString()
              };
            })
          );
          details.push(...batchDetails.filter(Boolean));
        }

        if (localRunRef.current) {
          await fetch("/api/emails/batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ emails: details })
          });

          await fetch(`/api/jobs/${jobId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              processedCount: (activeJob?.processedCount || 0) + details.length,
              lastPageToken: currentToken,
              updatedAt: new Date().toISOString() 
            })
          });
        } else {
          const batch = writeBatch(db);
          details.forEach(email => {
            const emailRef = doc(db, "emails", email.id);
            batch.set(emailRef, email);
          });
          await batch.commit();

          await updateDoc(doc(db, "jobs", jobId), {
            processedCount: (activeJob?.processedCount || 0) + details.length,
            lastPageToken: currentToken || null,
            updatedAt: serverTimestamp()
          });
        }

        setActiveJob(prev => prev ? {
          ...prev,
          processedCount: prev.processedCount + details.length,
          lastPageToken: currentToken
        } : null);

      } catch (err) {
        console.error("Download error", err);
        setDownloading(false);
        break;
      }
    }
  };

  const runAnalysisLoop = async (jobId: string) => {
    const startTime = Date.now();
    const MAX_DURATION = 30 * 60 * 1000;

    while (true) {
      const timeLimitReached = !disableTimeLimitRef.current && (Date.now() - startTime > MAX_DURATION);
      if (isStoppingAnalysisRef.current || timeLimitReached) {
        if (localRunRef.current) {
          await fetch(`/api/jobs/${jobId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ analysis_status: 'paused', updatedAt: new Date().toISOString() })
          });
        } else {
          await updateDoc(doc(db, "jobs", jobId), {
            analysis_status: 'paused',
            updatedAt: serverTimestamp()
          });
        }
        setActiveJob(prev => prev ? { ...prev, analysis_status: 'paused' } : null);
        setAnalyzing(false);
        break;
      }

      try {
        let pendingEmails = [];
        if (localRunRef.current) {
          const res = await fetch(`/api/emails/pending/${jobId}`);
          pendingEmails = await res.json();
        } else {
          const q = query(
            collection(db, "emails"), 
            where("jobId", "==", jobId), 
            where("analyzed", "==", 0), 
            limit(50)
          );
          const snap = await getDocs(q);
          pendingEmails = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        }

        if (pendingEmails.length === 0) {
          if (localRunRef.current) {
            await fetch(`/api/jobs/${jobId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ analysis_status: 'completed', updatedAt: new Date().toISOString() })
            });
          } else {
            await updateDoc(doc(db, "jobs", jobId), {
              analysis_status: 'completed',
              updatedAt: serverTimestamp()
            });
          }
          setActiveJob(prev => prev ? { ...prev, analysis_status: 'completed' } : null);
          setAnalyzing(false);
          fetchProcessedEmails(jobId);
          break;
        }

        const prompt = `Current Date: ${new Date().toLocaleDateString()}.
        Analyze these emails and identify "rubbish" (spam, newsletters, promotional clutter). 
        IMPORTANT: Any message older than 2 years is much more likely to be rubbish.
        For emails that are NOT rubbish, suggest a folder name (label) to organize them into (e.g., "Work", "Finance", "Travel", "Personal").
        Return a JSON array of objects with "id", "isRubbish" (boolean), "reason" (short explanation), and "suggestedFolder" (string, only for non-rubbish).
        Emails: ${JSON.stringify(pendingEmails.map((d: any) => ({ 
          id: d.id, 
          subject: d.subject, 
          from: d.from, 
          snippet: d.snippet,
          date: new Date(d.timestamp).toLocaleDateString()
        })))}`;

        let results = [];
        if (localLlmEnabledRef.current) {
          const headers: any = { "Content-Type": "application/json" };
          if (localLlmApiKeyRef.current) headers["Authorization"] = `Bearer ${localLlmApiKeyRef.current}`;

          const response = await fetch(localLlmEndpointRef.current, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: localLlmModelRef.current,
              prompt: prompt + "\n\nResponse must be valid JSON array only.",
              stream: false,
              format: "json"
            })
          });
          const data = await response.json();
          const text = data.response || data.content || "";
          const jsonStart = text.indexOf('[');
          const jsonEnd = text.lastIndexOf(']') + 1;
          results = JSON.parse(text.substring(jsonStart, jsonEnd) || "[]");
        } else {
          const aiResponse = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: { responseMimeType: "application/json" }
          });
          results = JSON.parse(aiResponse.text || "[]");
        }

        const analyzedEmails = pendingEmails.map((email: any) => {
          const result = results.find((r: any) => r.id === email.id);
          return {
            ...email,
            isRubbish: Boolean(result?.isRubbish),
            reason: result?.reason || "",
            suggestedFolder: result?.suggestedFolder || "",
            analyzed: 1,
            createdAt: new Date().toISOString()
          };
        });

        const rubbishBatchCount = analyzedEmails.filter((e: any) => e.isRubbish).length;
        
        if (localRunRef.current) {
          await fetch("/api/emails/batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ emails: analyzedEmails })
          });

          await fetch(`/api/jobs/${jobId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              analyzedCount: (activeJob?.analyzedCount || 0) + analyzedEmails.length,
              rubbishCount: (activeJob?.rubbishCount || 0) + rubbishBatchCount,
              updatedAt: new Date().toISOString() 
            })
          });
        } else {
          const batch = writeBatch(db);
          analyzedEmails.forEach(email => {
            const emailRef = doc(db, "emails", email.id);
            batch.set(emailRef, email, { merge: true });
          });
          await batch.commit();

          await updateDoc(doc(db, "jobs", jobId), {
            analyzedCount: (activeJob?.analyzedCount || 0) + analyzedEmails.length,
            rubbishCount: (activeJob?.rubbishCount || 0) + rubbishBatchCount,
            updatedAt: serverTimestamp()
          });
        }

        setActiveJob(prev => prev ? {
          ...prev,
          analyzedCount: prev.analyzedCount + analyzedEmails.length,
          rubbishCount: prev.rubbishCount + rubbishBatchCount
        } : null);

      } catch (err) {
        console.error("Analysis error", err);
        setAnalyzing(false);
        break;
      }
    }
  };

  const deleteFromSender = async (sender: string) => {
    if (!accessToken) return;
    setCleaning(true);
    try {
      // Find all messages from this sender
      const q = `from:${sender}`;
      const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
      url.searchParams.append("q", q);
      url.searchParams.append("maxResults", "500");

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const data = await response.json();
      const messages = data.messages || [];

      if (messages.length === 0) {
        setError("No messages found from this sender.");
        return;
      }

      const chunkSize = 50;
      for (let i = 0; i < messages.length; i += chunkSize) {
        const chunk = messages.slice(i, i + chunkSize);
        await Promise.all(chunk.map((m: any) => 
          fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}/trash`, {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}` }
          })
        ));
      }
      // Refresh view
      if (activeJob) fetchProcessedEmails(activeJob.id);
    } catch (err) {
      setError("Failed to delete from sender");
    } finally {
      setCleaning(false);
    }
  };

  const cleanUpSelected = async () => {
    if (!accessToken) return;
    const idsToTrash = processedEmails.filter(e => e.selected).map(e => e.id);
    if (idsToTrash.length === 0) return;

    setCleaning(true);
    try {
      const chunkSize = 50;
      for (let i = 0; i < idsToTrash.length; i += chunkSize) {
        const chunk = idsToTrash.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map(id => 
            fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/trash`, {
              method: "POST",
              headers: { Authorization: `Bearer ${accessToken}` }
            })
          )
        );
      }
      setProcessedEmails(prev => prev.filter(e => !idsToTrash.includes(e.id)));
    } catch (err) {
      setError("Cleanup failed.");
    } finally {
      setCleaning(false);
    }
  };

  const toggleSelectAll = (select: boolean) => {
    setEmails(prev => prev.map(e => ({ ...e, selected: select })));
  };

  const toggleSelectRubbish = () => {
    setEmails(prev => prev.map(e => ({ ...e, selected: !!e.isRubbish })));
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    );
  }

  if (!user || !accessToken) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full text-center space-y-8"
        >
          <div className="relative inline-block">
            <div className="absolute -inset-4 bg-emerald-500/20 blur-2xl rounded-full" />
            <Mail className="w-20 h-20 text-emerald-500 relative" />
          </div>
          
          <div className="space-y-4">
            <h1 className="text-5xl font-black tracking-tighter italic uppercase">Sweep</h1>
            <p className="text-zinc-400 text-lg font-medium">
              The zero-config AI Gmail cleaner. No secrets, just results.
            </p>
          </div>

          <button
            onClick={handleConnect}
            className="group relative w-full py-5 px-8 bg-white text-zinc-950 rounded-2xl font-black uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-4 shadow-[0_0_40px_rgba(16,185,129,0.2)]"
          >
            <ShieldCheck className="w-6 h-6" />
            <span>Connect Gmail</span>
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </button>

          <p className="text-xs text-zinc-500">
            Make sure to check the "Modify your emails" box during login so Gemini can help you clean up.
          </p>

          <div className="pt-8 border-t border-zinc-900 flex justify-center gap-8 opacity-40 grayscale">
            <img src="https://www.gstatic.com/images/branding/product/2x/gmail_64dp.png" className="h-8" alt="Gmail" referrerPolicy="no-referrer" />
            <img src="https://www.gstatic.com/lamda/images/gemini_sparkle_v002.svg" className="h-8" alt="Gemini" referrerPolicy="no-referrer" />
          </div>
        </motion.div>
      </div>
    );
  }

  const selectedCount = processedEmails.filter(e => e.selected).length;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-emerald-500/30">
      <header className="border-b border-zinc-900 bg-zinc-950/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Mail className="w-6 h-6 text-zinc-950" />
            </div>
            <span className="font-black text-2xl tracking-tighter uppercase italic">Sweep</span>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 rounded-xl border border-zinc-800">
              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Local Run</span>
              <button
                onClick={() => setLocalRun(!localRun)}
                className={`w-8 h-4 rounded-full transition-all relative ${localRun ? 'bg-emerald-500' : 'bg-zinc-700'}`}
              >
                <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${localRun ? 'left-4.5' : 'left-0.5'}`} />
              </button>
            </div>
            <button 
              onClick={() => setShowSettings(true)}
              className="p-2 hover:bg-zinc-900 rounded-xl transition-colors text-zinc-400 hover:text-white"
              title="Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
            <div className="hidden md:flex items-center gap-3 px-4 py-2 bg-zinc-900 rounded-full border border-zinc-800">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-sm font-medium text-zinc-400">{user.email}</span>
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 hover:bg-red-500/10 text-zinc-500 hover:text-red-400 rounded-xl transition-all"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 lg:p-12 space-y-12">
        {showJobSelector ? (
          <div className="space-y-12">
            <div className="text-center space-y-4">
              <h2 className="text-6xl font-black tracking-tighter uppercase italic leading-none">
                Inbox <span className="text-emerald-500">Analysis</span>
              </h2>
              <p className="text-zinc-400 text-xl max-w-2xl mx-auto">
                Start a fresh scan or continue where you left off. We'll process your entire inbox in the background.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
              <button
                onClick={createNewJob}
                className="group p-8 bg-zinc-900 border border-zinc-800 rounded-[32px] text-left hover:border-emerald-500/50 transition-all space-y-6"
              >
                <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Plus className="w-8 h-8 text-emerald-500" />
                </div>
                <div>
                  <h3 className="text-2xl font-black uppercase tracking-tight">Create New Job</h3>
                  <p className="text-zinc-500 mt-2">Start a full rescan of your inbox from the very beginning.</p>
                </div>
              </button>

              <div className="p-8 bg-zinc-900 border border-zinc-800 rounded-[32px] space-y-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-zinc-800 rounded-xl flex items-center justify-center">
                    <History className="w-6 h-6 text-zinc-400" />
                  </div>
                  <h3 className="text-2xl font-black uppercase tracking-tight">Previous Jobs</h3>
                </div>
                
                <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                  {availableJobs.length === 0 ? (
                    <p className="text-zinc-600 italic py-4">No previous jobs found.</p>
                  ) : (
                    availableJobs.map(job => (
                      <button
                        key={job.id}
                        onClick={() => continueJob(job)}
                        className="w-full p-4 bg-zinc-950 border border-zinc-800 rounded-2xl flex items-center justify-between hover:border-zinc-600 transition-all group"
                      >
                        <div className="text-left">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-zinc-300">
                              {new Date(job.createdAt).toLocaleDateString()}
                            </span>
                            <span className={`px-2 py-0.5 text-[10px] font-black uppercase rounded-full ${
                              job.status === 'completed' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-zinc-800 text-zinc-500'
                            }`}>
                              {job.status}
                            </span>
                          </div>
                          <div className="text-xs text-zinc-500 mt-1">
                            {job.processedCount} processed • {job.rubbishCount} rubbish
                          </div>
                        </div>
                        <ArrowRight className="w-5 h-5 text-zinc-700 group-hover:text-zinc-300 group-hover:translate-x-1 transition-all" />
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-12">
            {/* Active Job Dashboard */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-[40px] p-8 lg:p-12 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-8">
                <button 
                  onClick={() => setShowJobSelector(true)}
                  className="text-zinc-500 hover:text-zinc-300 font-bold uppercase tracking-widest text-xs flex items-center gap-2"
                >
                  <ChevronLeft className="w-4 h-4" /> Back to Jobs
                </button>
              </div>

              <div className="grid lg:grid-cols-3 gap-12 items-center">
                <div className="lg:col-span-2 space-y-8">
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <span className={`w-3 h-3 rounded-full ${(downloading || analyzing) ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-700'}`} />
                      <h2 className="text-4xl font-black tracking-tighter uppercase italic">
                        {activeJob?.status === 'completed' ? 'Job Completed' : (downloading || analyzing) ? 'Processing' : 'Job Paused'}
                      </h2>
                    </div>
                    <p className="text-zinc-400 text-lg">
                      Manage the download and AI analysis phases separately.
                    </p>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-6">
                    {/* Download Controls */}
                    <div className="p-6 bg-zinc-950/50 rounded-3xl border border-zinc-800/50 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Phase 1: Download</span>
                        <span className={`px-2 py-0.5 text-[8px] font-black uppercase rounded-full ${
                          activeJob?.download_status === 'completed' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-zinc-800 text-zinc-400'
                        }`}>
                          {activeJob?.download_status}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        {!downloading ? (
                          <button
                            onClick={() => startDownload()}
                            disabled={activeJob?.download_status === 'completed'}
                            className="flex-1 py-3 bg-white text-zinc-950 rounded-xl font-black uppercase tracking-widest text-[10px] hover:scale-[1.02] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                          >
                            <Play className="w-3 h-3 fill-current" /> Start Download
                          </button>
                        ) : (
                          <button
                            onClick={stopDownload}
                            className="flex-1 py-3 bg-zinc-800 text-white rounded-xl font-black uppercase tracking-widest text-[10px] hover:bg-zinc-700 transition-all flex items-center justify-center gap-2"
                          >
                            <Pause className="w-3 h-3 fill-current" /> Pause
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Analysis Controls */}
                    <div className="p-6 bg-zinc-950/50 rounded-3xl border border-zinc-800/50 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Phase 2: AI Analysis</span>
                        <span className={`px-2 py-0.5 text-[8px] font-black uppercase rounded-full ${
                          activeJob?.analysis_status === 'completed' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-zinc-800 text-zinc-400'
                        }`}>
                          {activeJob?.analysis_status}
                        </span>
                      </div>
                      
                      {activeJob && activeJob.processedCount > 0 && (
                        <div className="space-y-1">
                          <div className="flex justify-between text-[8px] font-black uppercase tracking-widest text-zinc-500">
                            <span>Progress</span>
                            <span>{Math.round((activeJob.analyzedCount / activeJob.processedCount) * 100)}%</span>
                          </div>
                          <div className="h-1 bg-zinc-900 rounded-full overflow-hidden">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${(activeJob.analyzedCount / activeJob.processedCount) * 100}%` }}
                              className="h-full bg-emerald-500"
                            />
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-3">
                        {!analyzing ? (
                          <button
                            onClick={startAnalysis}
                            disabled={activeJob?.analysis_status === 'completed'}
                            className="flex-1 py-3 bg-emerald-500 text-zinc-950 rounded-xl font-black uppercase tracking-widest text-[10px] hover:bg-emerald-400 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                          >
                            <Sparkles className="w-3 h-3 fill-current" /> Start Analysis
                          </button>
                        ) : (
                          <button
                            onClick={stopAnalysis}
                            className="flex-1 py-3 bg-zinc-800 text-white rounded-xl font-black uppercase tracking-widest text-[10px] hover:bg-zinc-700 transition-all flex items-center justify-center gap-2"
                          >
                            <Pause className="w-3 h-3 fill-current" /> Pause
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {selectedCount > 0 && (
                    <button
                      onClick={cleanUpSelected}
                      disabled={cleaning}
                      className="w-full py-4 bg-red-600 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-red-500 transition-all disabled:opacity-50 flex items-center justify-center gap-3"
                    >
                      <Trash2 className="w-6 h-6" /> Trash {selectedCount} Selected
                    </button>
                  )}
                </div>

                <div className="bg-zinc-950/50 rounded-3xl p-8 border border-zinc-800/50 space-y-6">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Downloaded</span>
                      <div className="text-2xl font-black text-zinc-100">{activeJob?.processedCount}</div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Analyzed</span>
                      <div className="text-2xl font-black text-zinc-100">{activeJob?.analyzedCount}</div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Rubbish</span>
                      <div className="text-2xl font-black text-emerald-500">{activeJob?.rubbishCount}</div>
                    </div>
                  </div>
                  
                  <div className="pt-6 border-t border-zinc-900 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-zinc-500">
                      <Clock className="w-4 h-4" />
                      <span className="text-xs font-bold">Started {new Date(activeJob?.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                      activeJob?.status === 'completed' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-zinc-800 text-zinc-400'
                    }`}>
                      {activeJob?.status}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Processed Emails Feed */}
            <div className="space-y-8">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <h3 className="text-3xl font-black tracking-tighter uppercase italic">Processed Results</h3>
                  <div className="px-3 py-1 bg-zinc-900 rounded-full border border-zinc-800 text-xs font-bold text-zinc-500">
                    Page {currentPage}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setProcessedEmails(prev => prev.map(e => ({ ...e, selected: true })))}
                    className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 text-[10px] font-black uppercase tracking-widest rounded-xl border border-zinc-800 transition-all"
                  >
                    Select All
                  </button>
                  <button 
                    onClick={() => setProcessedEmails(prev => prev.map(e => ({ ...e, selected: !!e.isRubbish })))}
                    className="px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 text-[10px] font-black uppercase tracking-widest rounded-xl border border-emerald-500/20 transition-all"
                  >
                    Select Rubbish
                  </button>
                  <button 
                    onClick={() => setProcessedEmails(prev => prev.map(e => ({ ...e, selected: false })))}
                    className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 text-[10px] font-black uppercase tracking-widest rounded-xl border border-zinc-800 transition-all"
                  >
                    Deselect All
                  </button>
                  <button 
                    onClick={() => {
                      const selected = processedEmails.filter(e => e.selected && e.suggestedFolder);
                      if (selected.length > 0) {
                        const folders = [...new Set(selected.map(e => e.suggestedFolder))].filter(Boolean) as string[];
                        folders.forEach(folder => {
                          const ids = selected.filter(e => e.suggestedFolder === folder).map(e => e.id);
                          moveEmailsToFolder(ids, folder);
                        });
                      }
                    }}
                    disabled={cleaning}
                    className="px-4 py-2 bg-emerald-500 text-zinc-950 text-[10px] font-black uppercase tracking-widest rounded-xl hover:scale-105 transition-all flex items-center gap-2 disabled:opacity-50"
                  >
                    <FolderPlus className="w-4 h-4" /> Organize Selected
                  </button>
                </div>
              </div>

              <div className="grid gap-4">
                <AnimatePresence mode="popLayout">
                  {processedEmails.map((email) => (
                    <motion.div
                      key={email.id}
                      layout
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className={`group p-3 rounded-2xl border transition-all duration-300 ${
                        email.selected 
                          ? 'bg-red-500/5 border-red-500/40 shadow-[0_0_30px_rgba(239,68,68,0.05)]' 
                          : 'bg-zinc-900/40 border-zinc-800/50 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-start gap-4">
                        <div className="pt-0.5">
                          <button 
                            onClick={() => setProcessedEmails(prev => prev.map(e => e.id === email.id ? { ...e, selected: !e.selected } : e))}
                            className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${
                              email.selected 
                                ? 'bg-red-500 border-red-500 text-white' 
                                : 'border-zinc-800 hover:border-zinc-600'
                            }`}
                          >
                            {email.selected && <CheckCircle2 className="w-4 h-4" />}
                          </button>
                        </div>

                        <div className="flex-1 min-w-0 space-y-4">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-sm font-black uppercase ${
                                email.isRubbish ? 'bg-red-500/20 text-red-400' : 'bg-zinc-800 text-zinc-400'
                              }`}>
                                {email.from.charAt(0)}
                              </div>
                              <div className="flex flex-col">
                                <span className="font-bold truncate text-zinc-100 text-sm tracking-tight">{email.from}</span>
                                <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
                                  {new Date(email.timestamp).toLocaleString()}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => deleteFromSender(email.from)}
                                className="px-3 py-1.5 bg-zinc-950 hover:bg-red-500/10 text-zinc-500 hover:text-red-500 text-[10px] font-black uppercase tracking-widest rounded-lg border border-zinc-800 transition-all flex items-center gap-2"
                              >
                                <Trash2 className="w-3 h-3" /> Delete All from Sender
                              </button>
                              {email.isRubbish && (
                                <span className="px-3 py-1 bg-red-500/10 text-red-500 text-[10px] font-black uppercase tracking-widest rounded-full border border-red-500/20">
                                  Rubbish
                                </span>
                              )}
                              {email.suggestedFolder && !email.isRubbish && (
                                <span className="px-3 py-1 bg-emerald-500/10 text-emerald-500 text-[10px] font-black uppercase tracking-widest rounded-full border border-emerald-500/20 flex items-center gap-1">
                                  <Folder className="w-3 h-3" /> {email.suggestedFolder}
                                </span>
                              )}
                            </div>
                          </div>
                          
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex-1">
                              <h4 className="text-xl font-bold text-zinc-100 leading-tight">{email.subject}</h4>
                              <p className="text-zinc-500 text-sm line-clamp-2 leading-relaxed mt-2">{email.snippet}</p>
                            </div>
                            {email.suggestedFolder && !email.isRubbish && (
                              <button 
                                onClick={() => moveEmailsToFolder([email.id], email.suggestedFolder!)}
                                disabled={cleaning}
                                className="px-4 py-2 bg-emerald-500 text-zinc-950 text-[10px] font-black uppercase tracking-widest rounded-xl hover:scale-105 transition-all flex items-center gap-2 disabled:opacity-50 flex-shrink-0"
                              >
                                <ArrowUpRight className="w-3 h-3" /> Move to {email.suggestedFolder}
                              </button>
                            )}
                          </div>

                          {email.reason && (
                            <div className="flex items-start gap-3 p-4 bg-zinc-950/50 rounded-2xl border border-zinc-800/50">
                              <Sparkles className="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                              <p className="text-sm text-zinc-400 italic leading-relaxed">
                                <span className="font-black text-emerald-500/70 uppercase tracking-widest text-[10px] mr-2">AI Analysis:</span>
                                {email.reason}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>

                {processedEmails.length === 0 && !loading && (
                  <div className="text-center py-32 bg-zinc-900/20 rounded-[40px] border-2 border-dashed border-zinc-900">
                    <div className="w-20 h-20 bg-zinc-900 rounded-full flex items-center justify-center mx-auto mb-6">
                      <Search className="w-10 h-10 text-zinc-700" />
                    </div>
                    <p className="text-zinc-500 font-bold uppercase tracking-widest text-sm">No emails processed yet</p>
                  </div>
                )}

                {loading && (
                  <div className="space-y-4">
                    {[1,2,3].map(i => (
                      <div key={i} className="h-48 bg-zinc-900/50 animate-pulse rounded-[32px] border border-zinc-800" />
                    ))}
                  </div>
                )}

                {hasMore && (
                  <div className="pt-8 flex justify-center">
                    <button
                      onClick={() => fetchProcessedEmails(activeJob!.id, true)}
                      disabled={loading}
                      className="px-12 py-5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-2xl font-black uppercase tracking-widest text-xs transition-all flex items-center gap-3 border border-zinc-800"
                    >
                      {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                      Load More Results
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-[32px] p-8 space-y-8"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center">
                    <Settings className="w-5 h-5 text-emerald-500" />
                  </div>
                  <h2 className="text-2xl font-black uppercase tracking-tighter italic">Settings</h2>
                </div>
                <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-zinc-800 rounded-lg transition-colors">
                  <Plus className="w-6 h-6 rotate-45 text-zinc-500" />
                </button>
              </div>

              <div className="space-y-6">
                <div className="p-6 bg-zinc-950 rounded-2xl border border-zinc-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Cpu className="w-5 h-5 text-emerald-500" />
                      <div>
                        <p className="text-sm font-bold">Local LLM Mode</p>
                        <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Use Ollama or Llama.cpp</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setLocalLlmEnabled(!localLlmEnabled)}
                      className={`w-12 h-6 rounded-full transition-all relative ${localLlmEnabled ? 'bg-emerald-500' : 'bg-zinc-800'}`}
                    >
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${localLlmEnabled ? 'left-7' : 'left-1'}`} />
                    </button>
                  </div>

                  {localLlmEnabled && (
                    <div className="space-y-4 pt-4 border-t border-zinc-900">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Endpoint URL</label>
                        <input 
                          type="text" 
                          value={localLlmEndpoint}
                          onChange={(e) => setLocalLlmEndpoint(e.target.value)}
                          placeholder="http://localhost:11434/api/generate"
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-emerald-500/50 transition-all"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Model Name</label>
                        <input 
                          type="text" 
                          value={localLlmModel}
                          onChange={(e) => setLocalLlmModel(e.target.value)}
                          placeholder="llama3"
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-emerald-500/50 transition-all"
                        />
                      </div>
                      <p className="text-[10px] text-zinc-500 italic">
                        Note: Local LLM mode works best when running this app locally. In the cloud preview, ensure your local endpoint is exposed via a tunnel (like ngrok) or use the default Gemini.
                      </p>
                    </div>
                  )}
                </div>

                <div className="p-6 bg-zinc-950 rounded-2xl border border-zinc-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <InfinityIcon className="w-5 h-5 text-emerald-500" />
                      <div>
                        <p className="text-sm font-bold">Disable Time Limit</p>
                        <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Run until mailbox is empty</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setDisableTimeLimit(!disableTimeLimit)}
                      className={`w-12 h-6 rounded-full transition-all relative ${disableTimeLimit ? 'bg-emerald-500' : 'bg-zinc-800'}`}
                    >
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${disableTimeLimit ? 'left-7' : 'left-1'}`} />
                    </button>
                  </div>
                </div>
              </div>

              <button 
                onClick={() => setShowSettings(false)}
                className="w-full py-4 bg-white text-zinc-950 rounded-2xl font-black uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-all"
              >
                Save & Close
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

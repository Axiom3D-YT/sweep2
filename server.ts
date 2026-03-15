import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import Database from "better-sqlite3";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const db = new Database("sweep.db");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT,
    last_login TEXT
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    uid TEXT,
    status TEXT,
    download_status TEXT DEFAULT 'idle',
    analysis_status TEXT DEFAULT 'idle',
    last_page_token TEXT,
    processed_count INTEGER DEFAULT 0,
    analyzed_count INTEGER DEFAULT 0,
    rubbish_count INTEGER DEFAULT 0,
    last_sync_timestamp TEXT,
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS emails (
    id TEXT PRIMARY KEY,
    job_id TEXT,
    uid TEXT,
    subject TEXT,
    sender TEXT,
    snippet TEXT,
    timestamp TEXT,
    is_rubbish INTEGER DEFAULT 0,
    reason TEXT,
    suggested_folder TEXT,
    analyzed INTEGER DEFAULT 0,
    created_at TEXT
  );
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // API Routes
  app.post("/api/users", (req, res) => {
    const { id, email, lastLogin } = req.body;
    const stmt = db.prepare("INSERT OR REPLACE INTO users (id, email, last_login) VALUES (?, ?, ?)");
    stmt.run(id, email, lastLogin);
    res.json({ success: true });
  });

  app.get("/api/jobs/:uid", (req, res) => {
    const stmt = db.prepare("SELECT * FROM jobs WHERE uid = ? ORDER BY created_at DESC");
    const jobs = stmt.all(req.params.uid);
    res.json(jobs);
  });

  app.post("/api/jobs", (req, res) => {
    const { id, uid, status, created_at, updated_at } = req.body;
    const stmt = db.prepare("INSERT INTO jobs (id, uid, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)");
    stmt.run(id, uid, status, created_at, updated_at);
    res.json({ success: true });
  });

  app.patch("/api/jobs/:id", (req, res) => {
    const updates = req.body;
    console.log(`[DEBUG] Updating job ${req.params.id}:`, updates);
    const keys = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = keys.map(k => `${k} = ?`).join(", ");
    const stmt = db.prepare(`UPDATE jobs SET ${setClause} WHERE id = ?`);
    stmt.run(...values, req.params.id);
    res.json({ success: true });
  });

  app.get("/api/emails/:jobId", (req, res) => {
    const { uid, limit = 100, offset = 0 } = req.query;
    const stmt = db.prepare(`
      SELECT 
        id, job_id as jobId, uid, subject, sender as "from", snippet, timestamp, 
        is_rubbish as isRubbish, reason, suggested_folder as suggestedFolder, 
        analyzed, created_at as createdAt 
      FROM emails 
      WHERE job_id = ? AND uid = ? 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `);
    const emails = stmt.all(req.params.jobId, uid, Number(limit), Number(offset));
    res.json(emails.map(e => ({ ...e, isRubbish: Boolean(e.isRubbish) })));
  });

  app.post("/api/emails/batch", (req, res) => {
    const { emails } = req.body;
    console.log(`[DEBUG] Received batch of ${emails?.length || 0} emails for processing`);
    
    const insert = db.prepare(`
      INSERT OR REPLACE INTO emails 
      (id, job_id, uid, subject, sender, snippet, timestamp, is_rubbish, reason, suggested_folder, analyzed, created_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const transaction = db.transaction((emails) => {
      for (const email of emails) {
        insert.run(
          email.id, 
          email.jobId, 
          email.uid, 
          email.subject, 
          email.from, 
          email.snippet, 
          email.timestamp, 
          email.isRubbish ? 1 : 0, 
          email.reason, 
          email.suggestedFolder, 
          email.analyzed ? 1 : 0, 
          email.createdAt
        );
      }
    });

    try {
      transaction(emails);
      console.log(`[DEBUG] Successfully processed batch of ${emails.length} emails`);
      res.json({ success: true });
    } catch (error) {
      console.error(`[DEBUG] Error processing email batch:`, error);
      res.status(500).json({ error: "Failed to process batch" });
    }
  });

  app.get("/api/emails/pending/:jobId", (req, res) => {
    const stmt = db.prepare(`
      SELECT 
        id, job_id as jobId, uid, subject, sender as "from", snippet, timestamp, 
        is_rubbish as isRubbish, reason, suggested_folder as suggestedFolder, 
        analyzed, created_at as createdAt 
      FROM emails 
      WHERE job_id = ? AND analyzed = 0 
      LIMIT 50
    `);
    const emails = stmt.all(req.params.jobId);
    res.json(emails);
  });

  app.get("/api/config", (req, res) => {
    res.json({
      firebase: {
        apiKey: process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY,
        authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN,
        projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID,
        firestoreDatabaseId: process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || process.env.FIREBASE_FIRESTORE_DATABASE_ID || "(default)"
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

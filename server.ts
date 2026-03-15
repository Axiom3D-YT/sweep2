import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const dbPath = process.env.DATABASE_PATH || "sweep.db";
const db = new Database(dbPath);

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT,
    last_login TEXT,
    last_history_id TEXT,
    allowed_folders TEXT
  );

  CREATE TABLE IF NOT EXISTS emails (
    id TEXT PRIMARY KEY,
    uid TEXT,
    subject TEXT,
    sender TEXT,
    snippet TEXT,
    timestamp TEXT,
    labels TEXT,
    is_rubbish INTEGER DEFAULT 0,
    reason TEXT,
    suggested_folder TEXT,
    analyzed INTEGER DEFAULT 0,
    analyze_count INTEGER DEFAULT 0,
    created_at TEXT
  );
`);

// Handle schema migrations if old tables exist
try { db.exec("ALTER TABLE emails ADD COLUMN analyze_count INTEGER DEFAULT 0;"); } catch (e) {}
try { db.exec("ALTER TABLE users ADD COLUMN last_history_id TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE users ADD COLUMN allowed_folders TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE emails ADD COLUMN labels TEXT;"); } catch (e) {}
// Drop jobs table if it exists
try { db.exec("DROP TABLE IF EXISTS jobs;"); } catch(e) {}
// Drop jobs table if it exists
try {
  db.exec("DROP TABLE IF EXISTS jobs;");
} catch(e) {}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // Set COOP/COEP headers for Firebase Auth popups
  app.use((req, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
    next();
  });

  // API Routes
  app.post("/api/users", (req, res) => {
    const { id, email, lastLogin } = req.body;
    // Use INSERT OR IGNORE to not overwrite last_history_id on login
    const stmt = db.prepare("INSERT OR IGNORE INTO users (id, email, last_login) VALUES (?, ?, ?)");
    stmt.run(id, email, lastLogin);
    
    // Update last login
    const updateStmt = db.prepare("UPDATE users SET last_login = ? WHERE id = ?");
    updateStmt.run(lastLogin, id);
    res.json({ success: true });
  });

  app.get("/api/users/:id", (req, res) => {
    const stmt = db.prepare("SELECT * FROM users WHERE id = ?");
    const user = stmt.get(req.params.id);
    res.json(user || {});
  });

  app.patch("/api/users/:id", (req, res) => {
    const { lastHistoryId, allowedFolders } = req.body;
    if (lastHistoryId !== undefined) {
      db.prepare("UPDATE users SET last_history_id = ? WHERE id = ?").run(lastHistoryId, req.params.id);
    }
    if (allowedFolders !== undefined) {
      db.prepare("UPDATE users SET allowed_folders = ? WHERE id = ?").run(allowedFolders, req.params.id);
    }
    res.json({ success: true });
  });

  app.get("/api/prompts/:size/:variant", (req, res) => {
    const { size, variant } = req.params;
    const filePath = path.join(process.cwd(), "prompts", `batch_${size}_${variant}.md`);
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        res.json({ content });
      } else {
        const fallbackPath = path.join(process.cwd(), "prompt.md");
        const content = fs.readFileSync(fallbackPath, "utf-8");
        res.json({ content });
      }
    } catch (err) {
      res.status(500).json({ error: "Failed to read prompt" });
    }
  });

  app.get("/api/emails/:uid", (req, res) => {
    const { 
      limit = 100, 
      offset = 0,
      search,
      sender,
      after,
      before,
      status, // 'analyzed' | 'unanalyzed' | 'all'
      rubbish, // 'true' | 'false' | 'all'
      folder,
      suggestedFolder
    } = req.query;

    let query = `SELECT id, uid, subject, sender as "from", snippet, timestamp, 
                 is_rubbish as isRubbish, reason, suggested_folder as suggestedFolder, 
                 analyzed, analyze_count as analyzeCount, created_at as createdAt 
                 FROM emails WHERE uid = ?`;
    const params: any[] = [req.params.uid];

    if (search) {
      query += ` AND (subject LIKE ? OR snippet LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }
    if (sender) {
      query += ` AND sender LIKE ?`;
      params.push(`%${sender}%`);
    }
    if (after) {
      query += ` AND timestamp >= ?`;
      params.push(after);
    }
    if (before) {
      query += ` AND timestamp <= ?`;
      params.push(before);
    }
    if (status === 'analyzed') {
      query += ` AND analyzed = 1`;
    } else if (status === 'unanalyzed') {
      query += ` AND analyzed = 0`;
    }
    if (rubbish === 'true') {
      query += ` AND is_rubbish = 1`;
    } else if (rubbish === 'false') {
      query += ` AND is_rubbish = 0`;
    }
    if (folder) {
      query += ` AND labels LIKE ?`;
      params.push(`%${folder}%`);
    }
    if (suggestedFolder) {
      query += ` AND suggested_folder = ?`;
      params.push(suggestedFolder);
    }

    query += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    params.push(Number(limit), Number(offset));

    const stmt = db.prepare(query);
    const emails = stmt.all(...params);
    res.json(emails.map((e: any) => ({ ...e, isRubbish: Boolean(e.isRubbish) })));
  });

  app.post("/api/emails/batch", (req, res) => {
    const { emails } = req.body;
    console.log(`[DEBUG] Received batch of ${emails?.length || 0} emails for insertion`);
    
    const insert = db.prepare(`
      INSERT OR REPLACE INTO emails 
      (id, uid, subject, sender, snippet, timestamp, labels, is_rubbish, reason, suggested_folder, analyzed, analyze_count, created_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const transaction = db.transaction((emails) => {
      for (const email of emails) {
        insert.run(
          email.id, 
          email.uid, 
          email.subject, 
          email.from, 
          email.snippet, 
          email.timestamp, 
          email.labels || "",
          email.isRubbish ? 1 : 0, 
          email.reason || "", 
          email.suggestedFolder || "", 
          email.analyzed ? 1 : 0, 
          email.analyzeCount || 0,
          email.createdAt || new Date().toISOString()
        );
      }
    });

    try {
      transaction(emails);
      res.json({ success: true });
    } catch (error) {
      console.error(`[DEBUG] Error processing email batch:`, error);
      res.status(500).json({ error: "Failed to process batch" });
    }
  });

  app.post("/api/emails/lookup", (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.json([]);
    
    const placeholders = ids.map(() => "?").join(",");
    const stmt = db.prepare(`
      SELECT id, is_rubbish as isRubbish, reason, suggested_folder as suggestedFolder, 
             analyzed, analyze_count as analyzeCount 
      FROM emails 
      WHERE id IN (${placeholders})
    `);
    const results = stmt.all(...ids);
    res.json(results.map((e: any) => ({ ...e, isRubbish: Boolean(e.isRubbish) })));
  });

  app.patch("/api/emails/:id", (req, res) => {
    const { isRubbish, reason, suggestedFolder, analyzed, analyzeCount } = req.body;
    const stmt = db.prepare(`
      UPDATE emails 
      SET is_rubbish = ?, reason = ?, suggested_folder = ?, analyzed = ?, analyze_count = ?
      WHERE id = ?
    `);
    try {
      stmt.run(isRubbish ? 1 : 0, reason, suggestedFolder, analyzed ? 1 : 0, analyzeCount, req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error(`[DEBUG] Error updating email ${req.params.id}:`, error);
      res.status(500).json({ error: "Failed to update email" });
    }
  });

  app.delete("/api/emails/:id", (req, res) => {
    const stmt = db.prepare("DELETE FROM emails WHERE id = ?");
    try {
      stmt.run(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete email" });
    }
  });

  app.get("/api/emails/pending/:uid", (req, res) => {
    const { limit = 1, offset = 0, folder } = req.query;
    let query = `SELECT id, uid, subject, sender as "from", snippet, timestamp, labels,
                 is_rubbish as isRubbish, reason, suggested_folder as suggestedFolder, 
                 analyzed, analyze_count as analyzeCount, created_at as createdAt 
                 FROM emails 
                 WHERE uid = ? AND analyzed = 0`;
    const params: any[] = [req.params.uid];
    
    if (folder) {
      query += ` AND labels LIKE ?`;
      params.push(`%${folder}%`);
    }

    query += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    params.push(Number(limit), Number(offset));

    const emails = db.prepare(query).all(...params);
    res.json(emails);
  });

  app.get("/api/stats/:uid", (req, res) => {
    const stmt = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN analyzed = 1 THEN 1 ELSE 0 END) as analyzed,
        SUM(CASE WHEN is_rubbish = 1 THEN 1 ELSE 0 END) as rubbish
      FROM emails 
      WHERE uid = ?
    `);
    const stats = stmt.get(req.params.uid);
    res.json({
      total: Number(stats?.total || 0),
      analyzed: Number(stats?.analyzed || 0),
      rubbish: Number(stats?.rubbish || 0)
    });
  });

  app.get("/api/prompt", (req, res) => {
    try {
      const content = fs.readFileSync(path.join(process.cwd(), "prompt.md"), "utf-8");
      res.json({ content });
    } catch (err) {
      res.status(500).json({ error: "Failed to read prompt.md" });
    }
  });

  app.post("/api/generate", async (req, res) => {
    const { endpoint, method, headers, body } = req.body;
    console.log(`[DEBUG] Proxying LLM request to: ${endpoint}`);
    
    try {
      const response = await fetch(endpoint, {
        method: method || "POST",
        headers: headers || { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[DEBUG] LLM Proxy Error (${response.status}):`, errorText);
        return res.status(response.status).json({ error: errorText });
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("[DEBUG] Proxy execution error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/config", (req, res) => {
    res.json({
      geminiApiKey: process.env.GEMINI_API_KEY,
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
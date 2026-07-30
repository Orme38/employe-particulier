'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

let initSqlJs, SQL;
try {
  initSqlJs = require('sql.js');
} catch (e) {
  console.error('sql.js non trouve. Lancer: npm install');
  process.exit(1);
}

const app = express();

const JWT_SECRET = process.env.JWT_SECRET || 'emp-particulier-secret-key-change-in-prod';

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'database.sqlite');

let db;

function saveDb() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function calcHours(arrival, departure) {
  if (!arrival || !departure) return 0;
  const [ah, am] = arrival.split(':').map(Number);
  const [dh, dm] = departure.split(':').map(Number);
  if (isNaN(ah) || isNaN(am) || isNaN(dh) || isNaN(dm)) return 0;
  const start = ah * 60 + am;
  const end = dh * 60 + dm;
  if (end <= start) return 0;
  return Math.round((end - start) / 60 * 100) / 100;
}

// ───── sql.js helpers ─────
function qAll(sql, params) {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function qOne(sql, params) {
  const rows = qAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function qRun(sql, params) {
  db.run(sql, params);
}

// ───── AUTH MIDDLEWARE ─────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Non authentifie' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide' });
  }
}

function optionalAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch {}
  }
  next();
}

// ───── TIERS ─────
const TIERS = {
  free: { max_families: 2, max_attendances_per_month: 10 },
  pro: { max_families: 999999, max_attendances_per_month: 999999 },
};

function getTier(userId) {
  if (!userId) return TIERS.free;
  const sub = qOne("SELECT tier, status FROM subscriptions WHERE user_id = ? AND status = 'active'", [userId]);
  if (sub && sub.tier === 'pro') return TIERS.pro;
  return TIERS.free;
}

// ───── INIT DB ─────
async function initDb() {
  SQL = await initSqlJs();

  const SCHEMA_VERSION = 2;
  const resetDb = () => { if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH); };

  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
    db.run("PRAGMA foreign_keys=ON");
    const ver = qOne("SELECT value FROM settings WHERE key = 'schema_version'");
    if (!ver || parseInt(ver.value) < SCHEMA_VERSION) {
      console.log('Schema outdated, resetting database...');
      db.close();
      resetDb();
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }

  db.run("PRAGMA foreign_keys=ON");
  db.run("PRAGMA journal_mode=WAL");

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    tier TEXT DEFAULT 'free',
    status TEXT DEFAULT 'inactive',
    stripe_customer_id TEXT DEFAULT '',
    stripe_subscription_id TEXT DEFAULT '',
    current_period_end TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS families (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER DEFAULT NULL,
    family_name TEXT NOT NULL UNIQUE,
    service_type TEXT DEFAULT '',
    hourly_rate REAL DEFAULT 0,
    parent_email TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS attendances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER DEFAULT NULL,
    attendance_date TEXT NOT NULL,
    family_id INTEGER NOT NULL,
    family_name TEXT NOT NULL,
    arrival_time TEXT NOT NULL,
    departure_time TEXT NOT NULL,
    total_hours REAL DEFAULT 0,
    amount REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS caf_subsidies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER DEFAULT NULL,
    billing_month_label TEXT NOT NULL,
    family_name TEXT NOT NULL,
    caf_subsidy REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(billing_month_label, family_name)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
  qRun("INSERT OR REPLACE INTO settings (key, value) VALUES ('schema_version', '2')");
}

// ───── HELPERS ─────
const MONTHS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

function billingMonthLabel(month, year) {
  return `${MONTHS_FR[month - 1]} ${year}`;
}

// ───── MIDDLEWARE ─────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ───── AUTH ROUTES ─────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
    const existing = qOne("SELECT id FROM users WHERE email = ?", [email.trim().toLowerCase()]);
    if (existing) return res.status(409).json({ error: 'Email deja utilise' });
    const hash = await bcrypt.hash(password, 10);
    qRun("INSERT INTO users (email, password, name) VALUES (?, ?, ?)",
      [email.trim().toLowerCase(), hash, name || '']);
    const user = qOne("SELECT id, email, name, created_at FROM users WHERE email = ?", [email.trim().toLowerCase()]);
    qRun("INSERT OR IGNORE INTO subscriptions (user_id, tier, status) VALUES (?, 'free', 'active')", [user.id]);
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    saveDb();
    res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (e) {
    res.status(500).json({ error: 'Erreur lors de l\'inscription' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
    const user = qOne("SELECT * FROM users WHERE email = ?", [email.trim().toLowerCase()]);
    if (!user) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (e) {
    res.status(500).json({ error: 'Erreur lors de la connexion' });
  }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = qOne("SELECT id, email, name, created_at FROM users WHERE id = ?", [req.user.id]);
  if (!user) return res.status(404).json({ error: 'Utilisateur non trouve' });
  const sub = qOne("SELECT tier, status, current_period_end FROM subscriptions WHERE user_id = ?", [user.id]);
  res.json({ user, subscription: sub || { tier: 'free', status: 'active' } });
});

// ───── SUBSCRIPTION ROUTES ─────
app.get('/api/subscription/status', authMiddleware, (req, res) => {
  const sub = qOne("SELECT tier, status, current_period_end FROM subscriptions WHERE user_id = ?", [req.user.id]);
  const tier = getTier(req.user.id);
  res.json({
    tier: sub?.tier || 'free',
    status: sub?.status || 'active',
    current_period_end: sub?.current_period_end || null,
    limits: { max_families: tier.max_families, max_attendances_per_month: tier.max_attendances_per_month },
  });
});

app.post('/api/subscription/create-checkout', authMiddleware, (req, res) => {
  res.json({
    url: '/subscription?upgrade=manual',
    message: 'Mode demo - Contactez-nous pour passer en Pro (5€/mois). Dans une version finale, ceci redirigerait vers Stripe.',
  });
});

app.post('/api/subscription/cancel', authMiddleware, (req, res) => {
  qRun("UPDATE subscriptions SET tier='free', status='active', updated_at=datetime('now') WHERE user_id=?", [req.user.id]);
  saveDb();
  res.json({ ok: true, tier: 'free' });
});

// ───── DASHBOARD ─────
app.get('/api/dashboard', (req, res) => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  const prefix = `${year}-${month}`;

  const summary = qOne(`SELECT
    COUNT(DISTINCT a.family_name) as families_count,
    COUNT(a.id) as days_count,
    COALESCE(ROUND(SUM(a.total_hours), 2), 0) as total_hours,
    COALESCE(ROUND(SUM(a.amount), 2), 0) as total_amount
    FROM attendances a WHERE a.attendance_date LIKE ?`, [prefix + '%']) || { families_count: 0, days_count: 0, total_hours: 0, total_amount: 0 };

  const totalAllTime = qOne(`SELECT
    COUNT(DISTINCT a.family_name) as total_families,
    COALESCE(ROUND(SUM(a.amount), 2), 0) as total_earned
    FROM attendances a`) || { total_families: 0, total_earned: 0 };

  const recent = qAll("SELECT a.*, f.hourly_rate FROM attendances a LEFT JOIN families f ON a.family_id = f.id ORDER BY a.created_at DESC LIMIT 5");

  res.json({
    month: MONTHS_FR[now.getMonth()],
    year,
    current_month: summary,
    all_time: totalAllTime,
    recent,
  });
});

// ───── API ROUTES ─────
app.get('/api/families', optionalAuth, (req, res) => {
  const s = req.query.search;
  let sql = "SELECT * FROM families";
  const p = [];
  if (req.user) {
    sql += " WHERE user_id = ? OR user_id IS NULL";
    p.push(req.user.id);
  }
  if (s) {
    sql += req.user ? " AND" : " WHERE";
    sql += " family_name LIKE ?";
    p.push(`%${s}%`);
  }
  sql += " ORDER BY family_name";
  res.json(qAll(sql, p));
});

app.post('/api/families', authMiddleware, (req, res) => {
  const d = req.body;
  const tier = getTier(req.user.id);
  const count = qOne("SELECT COUNT(*) as c FROM families WHERE user_id = ?", [req.user.id])?.c || 0;
  if (count >= tier.max_families) {
    return res.status(403).json({ error: 'Limite gratuite atteinte', upgrade: true, message: `Limite de ${tier.max_families} employeurs atteinte. Passez en Pro pour illimite.` });
  }
  qRun("INSERT INTO families (user_id, family_name, service_type, hourly_rate, parent_email) VALUES (?, ?, ?, ?, ?)",
    [req.user.id, d.family_name.trim(), d.service_type||'', parseFloat(d.hourly_rate)||0, d.parent_email||'']);
  const r = qOne("SELECT * FROM families WHERE family_name = ?", [d.family_name.trim()]);
  saveDb();
  res.status(201).json(r);
});

app.put('/api/families/:id', (req, res) => {
  const d = req.body;
  qRun("UPDATE families SET family_name=?, service_type=?, hourly_rate=?, parent_email=?, updated_at=datetime('now') WHERE id=?",
    [d.family_name.trim(), d.service_type||'', parseFloat(d.hourly_rate)||0, d.parent_email||'', req.params.id]);
  const r = qOne("SELECT * FROM families WHERE id = ?", [req.params.id]);
  saveDb();
  r ? res.json(r) : res.status(404).json({ error: 'not found' });
});

app.delete('/api/families/:id', (req, res) => {
  qRun("DELETE FROM attendances WHERE family_id = ?", [req.params.id]);
  qRun("DELETE FROM families WHERE id = ?", [req.params.id]);
  saveDb();
  res.json({ ok: true });
});

app.get('/api/families/by-name/:name', (req, res) => {
  const r = qOne("SELECT * FROM families WHERE family_name = ?", [req.params.name]);
  res.json(r || null);
});

app.get('/api/attendances', optionalAuth, (req, res) => {
  let sql = "SELECT a.*, f.hourly_rate FROM attendances a LEFT JOIN families f ON a.family_id = f.id WHERE 1=1";
  const p = [];
  if (req.user) {
    sql += " AND (a.user_id = ? OR a.user_id IS NULL)";
    p.push(req.user.id);
  }
  if (req.query.month && req.query.year) {
    sql += " AND a.attendance_date LIKE ?";
    p.push(`${req.query.year}-${String(req.query.month).padStart(2,'0')}%`);
  }
  if (req.query.family_name) { sql += " AND a.family_name = ?"; p.push(req.query.family_name); }
  sql += " ORDER BY a.attendance_date DESC, a.arrival_time DESC";
  if (req.query.limit) { sql += " LIMIT ?"; p.push(parseInt(req.query.limit)); }
  res.json(qAll(sql, p));
});

app.post('/api/attendances', authMiddleware, (req, res) => {
  const { attendance_date, family_name, arrival_time, departure_time } = req.body;
  const name = family_name.trim();
  let fam = qOne("SELECT * FROM families WHERE family_name = ?", [name]);
  if (!fam) {
    const tier = getTier(req.user.id);
    const count = qOne("SELECT COUNT(*) as c FROM families WHERE user_id = ?", [req.user.id])?.c || 0;
    if (count >= tier.max_families) {
      return res.status(403).json({ error: 'Limite gratuite atteinte', upgrade: true });
    }
    qRun("INSERT INTO families (user_id, family_name, hourly_rate) VALUES (?, ?, 0)", [req.user.id, name]);
    fam = qOne("SELECT * FROM families WHERE family_name = ?", [name]);
  }
  const tier = getTier(req.user.id);
  const monthPrefix = attendance_date.slice(0, 7);
  const monthCount = qOne("SELECT COUNT(*) as c FROM attendances WHERE user_id = ? AND attendance_date LIKE ?", [req.user.id, monthPrefix + '%'])?.c || 0;
  if (monthCount >= tier.max_attendances_per_month) {
    return res.status(403).json({ error: 'Limite gratuite atteinte', upgrade: true, message: `Limite de ${tier.max_attendances_per_month} presences/mois atteinte. Passez en Pro.` });
  }
  const hrs = calcHours(arrival_time, departure_time);
  const amt = Math.round(hrs * (fam.hourly_rate || 0) * 100) / 100;
  qRun("INSERT INTO attendances (user_id, attendance_date, family_id, family_name, arrival_time, departure_time, total_hours, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [req.user.id, attendance_date, fam.id, fam.family_name, arrival_time, departure_time, hrs, amt]);
  saveDb();
  const r = qOne("SELECT * FROM attendances WHERE id = last_insert_rowid()");
  res.status(201).json(r);
});

app.delete('/api/attendances/:id', (req, res) => {
  qRun("DELETE FROM attendances WHERE id = ?", [req.params.id]);
  saveDb();
  res.json({ ok: true });
});

app.get('/api/billing', (req, res) => {
  const month = parseInt(req.query.month);
  const year = parseInt(req.query.year);
  const prefix = `${year}-${String(month).padStart(2,'0')}`;

  const rows = qAll(`SELECT a.family_name, COUNT(a.id) as days,
    ROUND(SUM(a.total_hours),2) as total_hours,
    ROUND(SUM(a.amount),2) as gross_amount
    FROM attendances a WHERE a.attendance_date LIKE ?
    GROUP BY a.family_name ORDER BY a.family_name`, [prefix + '%']);

  const ml = billingMonthLabel(month, year);
  const result = rows.map(r => {
    const caf = qOne("SELECT * FROM caf_subsidies WHERE billing_month_label=? AND family_name=?", [ml, r.family_name]);
    const s = caf ? caf.caf_subsidy : 0;
    return {
      family_name: r.family_name,
      days: r.days,
      total_hours: r.total_hours,
      gross_amount: r.gross_amount,
      caf_subsidy: s,
      net_amount: Math.round((r.gross_amount - s) * 100) / 100
    };
  });
  res.json(result);
});

app.post('/api/billing/caf', (req, res) => {
  const { billing_month_label, family_name, caf_subsidy } = req.body;
  const val = parseFloat(caf_subsidy) || 0;
  const existing = qOne("SELECT * FROM caf_subsidies WHERE billing_month_label=? AND family_name=?", [billing_month_label, family_name]);
  if (existing) {
    qRun("UPDATE caf_subsidies SET caf_subsidy=?, updated_at=datetime('now') WHERE id=?", [val, existing.id]);
  } else {
    qRun("INSERT INTO caf_subsidies (billing_month_label, family_name, caf_subsidy) VALUES (?, ?, ?)", [billing_month_label, family_name, val]);
  }
  saveDb();
  res.json({ ok: true });
});

app.post('/api/settings/dark-mode', authMiddleware, (req, res) => {
  qRun("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    [`dark_mode_${req.user.id}`, req.body.dark ? '1' : '0']);
  saveDb();
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ───── START ─────
async function start() {
  await initDb();
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Employe de Particulier → http://localhost:${PORT}`);
  });
}

start().catch(e => {
  console.error('Erreur au demarrage:', e);
  process.exit(1);
});

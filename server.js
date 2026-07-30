'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');

let initSqlJs, SQL;
try {
  initSqlJs = require('sql.js');
} catch (e) {
  console.error('sql.js non trouve. Lancer: npm install');
  process.exit(1);
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'database.sqlite');

let db;

function saveDb() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

// ───── EMBEDDED CSV ─────
const CSV_FAMILIES = `id,family_name,service_type,hourly_rate,parent_email
1,Dupont,Garde d'enfants,4.5,dupont@email.fr
2,Martin,Garde d'enfants,5,martin@email.fr
3,Dridi,Ménage,0,
5,Risley,Jardinage,10,abd@gmail.com
6,Akriche,,0,`;

const CSV_ATTENDANCES = `id,attendance_date,family_name,arrival_time,departure_time,family_id
1,2026-07-01,Dupont,08:00:00,17:30:00,1
2,2026-07-02,Dupont,08:00:00,17:30:00,1
3,2026-07-03,Dupont,08:00:00,17:30:00,1
4,2026-07-06,Dupont,08:00:00,17:30:00,1
5,2026-07-07,Dupont,08:00:00,17:30:00,1
6,2026-07-01,Martin,08:30:00,16:30:00,2
7,2026-07-02,Martin,08:30:00,16:30:00,2
8,2026-07-03,Martin,08:30:00,16:30:00,2
9,2026-07-29,Dridi,08:00:00,17:00:00,3
11,2026-07-29,Akriche,08:00:00,17:00:00,6`;

const CSV_CAF = `id,billing_month_label,family_name,caf_subsidy
1,Juillet 2026,Dupont,90
2,Juillet 2026,Martin,60`;

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim());
    const row = {};
    headers.forEach((h, i) => { row[h] = vals[i]; });
    return row;
  });
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

// ───── INIT DB ─────
async function initDb() {
  SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  db.run("PRAGMA foreign_keys=ON");
  db.run("PRAGMA journal_mode=WAL");

  db.run(`CREATE TABLE IF NOT EXISTS families (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    family_name TEXT NOT NULL UNIQUE,
    service_type TEXT DEFAULT '',
    hourly_rate REAL DEFAULT 0,
    parent_email TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS attendances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    billing_month_label TEXT NOT NULL,
    family_name TEXT NOT NULL,
    caf_subsidy REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(billing_month_label, family_name)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);

  const seeded = qOne("SELECT value FROM settings WHERE key = 'seeded'");
  if (!seeded) {
    seed();
  }
}

function seed() {
  for (const f of parseCSV(CSV_FAMILIES)) {
    qRun(`INSERT OR IGNORE INTO families (id, family_name, service_type, hourly_rate, parent_email) VALUES (?, ?, ?, ?, ?)`,
      [parseInt(f.id) || null, f.family_name, f.service_type || '', parseFloat(f.hourly_rate) || 0, f.parent_email || '']);
  }

  for (const a of parseCSV(CSV_ATTENDANCES)) {
    const famId = parseInt(a.family_id) || null;
    const hrs = calcHours(a.arrival_time, a.departure_time);
    const fam = qOne("SELECT hourly_rate FROM families WHERE id = ?", [famId]);
    const rate = fam ? fam.hourly_rate : 0;
    const amt = Math.round(hrs * rate * 100) / 100;
    qRun(`INSERT OR IGNORE INTO attendances (id, attendance_date, family_id, family_name, arrival_time, departure_time, total_hours, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [parseInt(a.id) || null, a.attendance_date, famId, a.family_name, a.arrival_time, a.departure_time, hrs, amt]);
  }

  for (const c of parseCSV(CSV_CAF)) {
    qRun(`INSERT OR IGNORE INTO caf_subsidies (billing_month_label, family_name, caf_subsidy) VALUES (?, ?, ?)`,
      [c.billing_month_label, c.family_name, parseFloat(c.caf_subsidy) || 0]);
  }

  qRun("INSERT INTO settings (key, value) VALUES ('seeded', '1')");
  saveDb();
  console.log('Donnees initiales importees');
}

// ───── HELPERS ─────
const MONTHS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

function billingMonthLabel(month, year) {
  return `${MONTHS_FR[month - 1]} ${year}`;
}

// ───── API ─────
app.get('/api/families', (req, res) => {
  const s = req.query.search;
  const rows = s
    ? qAll("SELECT * FROM families WHERE family_name LIKE ? ORDER BY family_name", [`%${s}%`])
    : qAll("SELECT * FROM families ORDER BY family_name");
  res.json(rows);
});

app.post('/api/families', (req, res) => {
  const d = req.body;
  qRun("INSERT INTO families (family_name, service_type, hourly_rate, parent_email) VALUES (?, ?, ?, ?)",
    [d.family_name.trim(), d.service_type||'', parseFloat(d.hourly_rate)||0, d.parent_email||'']);
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

app.get('/api/attendances', (req, res) => {
  let sql = "SELECT a.*, f.hourly_rate FROM attendances a LEFT JOIN families f ON a.family_id = f.id WHERE 1=1";
  const p = [];
  if (req.query.month && req.query.year) {
    sql += " AND a.attendance_date LIKE ?";
    p.push(`${req.query.year}-${String(req.query.month).padStart(2,'0')}%`);
  }
  if (req.query.family_name) { sql += " AND a.family_name = ?"; p.push(req.query.family_name); }
  sql += " ORDER BY a.attendance_date DESC, a.arrival_time DESC";
  if (req.query.limit) { sql += " LIMIT ?"; p.push(parseInt(req.query.limit)); }
  res.json(qAll(sql, p));
});

app.post('/api/attendances', (req, res) => {
  const { attendance_date, family_name, arrival_time, departure_time } = req.body;
  const name = family_name.trim();
  let fam = qOne("SELECT * FROM families WHERE family_name = ?", [name]);
  if (!fam) {
    qRun("INSERT INTO families (family_name, hourly_rate) VALUES (?, 0)", [name]);
    fam = qOne("SELECT * FROM families WHERE family_name = ?", [name]);
  }
  const hrs = calcHours(arrival_time, departure_time);
  const amt = Math.round(hrs * (fam.hourly_rate || 0) * 100) / 100;
  qRun("INSERT INTO attendances (attendance_date, family_id, family_name, arrival_time, departure_time, total_hours, amount) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [attendance_date, fam.id, fam.family_name, arrival_time, departure_time, hrs, amt]);
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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ───── START ─────
async function start() {
  await initDb();
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Employé de Particulier → http://localhost:${PORT}`);
  });
}

start().catch(e => {
  console.error('Erreur au demarrage:', e);
  process.exit(1);
});

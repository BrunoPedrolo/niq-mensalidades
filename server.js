const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Render uses /tmp for writable storage (ephemeral) or env var for persistent
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'niq.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Init DB
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS pagamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ano INTEGER NOT NULL,
    mes INTEGER NOT NULL,
    nome TEXT NOT NULL,
    dia INTEGER,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(ano, mes, nome)
  );

  CREATE TABLE IF NOT EXISTS config (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS comprovantes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    mes INTEGER NOT NULL,
    ano INTEGER NOT NULL,
    dia INTEGER NOT NULL,
    valor REAL NOT NULL,
    gerado_em TEXT NOT NULL
  );
`);

// Seed initial data if empty
const count = db.prepare('SELECT COUNT(*) as n FROM pagamentos').get();
if (count.n === 0) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO pagamentos (ano, mes, nome, dia) VALUES (?, ?, ?, ?)
  `);
  const seed = db.transaction(() => {
    const dados = {
      2: ["Andrei Rossetti","Jarbas Junior de Matos","Maicon Luis Simoneti","Cleiton Aloisio Becker","Eliane dos Santos","Marcos Pilz","Gabriela Peretti","Leomir Borghardt","Joceli Nepomuceno","Lilian Aparecida Comparin","Bruno Henrique Pedrolo de Souza","Aline Romilda dos Santos Pituco","Juliana Paulus","Renan Antônio Breansini"],
      3: ["Andrei Rossetti","Jarbas Junior de Matos","Maicon Luis Simoneti","Cleiton Aloisio Becker","Eliane dos Santos","Marcos Pilz","Gabriela Peretti","Leomir Borghardt","Joceli Nepomuceno","Lilian Aparecida Comparin","Bruno Henrique Pedrolo de Souza","Aline Romilda dos Santos Pituco","Juliana Paulus","Renan Antônio Breansini","Yuri Signorati"],
      4: ["Jarbas Junior de Matos","Maicon Luis Simoneti","Cleiton Aloisio Becker","Eliane dos Santos","Marcos Pilz","Leomir Borghardt","Joceli Nepomuceno","Bruno Henrique Pedrolo de Souza","Aline Romilda dos Santos Pituco","Juliana Paulus","Renan Antônio Breansini","Yuri Signorati"],
      5: ["Jarbas Junior de Matos","Maicon Luis Simoneti","Cleiton Aloisio Becker","Eliane dos Santos","Marcos Pilz","Leomir Borghardt","Joceli Nepomuceno","Bruno Henrique Pedrolo de Souza","Aline Romilda dos Santos Pituco","Juliana Paulus","Renan Antônio Breansini"],
      6: ["Jarbas Junior de Matos","Eliane dos Santos","Joceli Nepomuceno"],
      7: ["Jarbas Junior de Matos","Eliane dos Santos","Joceli Nepomuceno"],
      8: ["Jarbas Junior de Matos","Eliane dos Santos","Joceli Nepomuceno"],
      9: ["Jarbas Junior de Matos","Eliane dos Santos","Joceli Nepomuceno"],
      10: ["Jarbas Junior de Matos","Eliane dos Santos","Joceli Nepomuceno"],
      11: ["Jarbas Junior de Matos","Eliane dos Santos","Joceli Nepomuceno"],
      12: ["Jarbas Junior de Matos","Eliane dos Santos","Joceli Nepomuceno"]
    };
    for (const [mes, nomes] of Object.entries(dados)) {
      for (const nome of nomes) insert.run(2026, parseInt(mes), nome, 10);
    }
  });
  seed();
  console.log('Dados iniciais inseridos.');
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── API PAGAMENTOS ──────────────────────────────────────────────────────────

// GET todos os pagamentos de um ano
app.get('/api/pagamentos/:ano', (req, res) => {
  const rows = db.prepare('SELECT mes, nome, dia FROM pagamentos WHERE ano = ?').all(req.params.ano);
  const result = {};
  for (const r of rows) {
    if (!result[r.mes]) result[r.mes] = {};
    if (r.dia) result[r.mes][r.nome] = r.dia;
  }
  res.json(result);
});

// POST registrar/atualizar pagamento
app.post('/api/pagamentos', (req, res) => {
  const { ano, mes, nome, dia } = req.body;
  if (!ano || !mes || !nome) return res.status(400).json({ error: 'Dados incompletos' });
  if (dia) {
    db.prepare(`
      INSERT INTO pagamentos (ano, mes, nome, dia, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(ano, mes, nome) DO UPDATE SET dia=excluded.dia, updated_at=excluded.updated_at
    `).run(ano, mes, nome, dia);
  } else {
    db.prepare('DELETE FROM pagamentos WHERE ano=? AND mes=? AND nome=?').run(ano, mes, nome);
  }
  res.json({ ok: true });
});

// POST bulk
app.post('/api/pagamentos/bulk', (req, res) => {
  const { registros } = req.body; // [{ano, mes, nome, dia}]
  if (!Array.isArray(registros)) return res.status(400).json({ error: 'Inválido' });
  const upsert = db.prepare(`
    INSERT INTO pagamentos (ano, mes, nome, dia, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(ano, mes, nome) DO UPDATE SET dia=excluded.dia, updated_at=excluded.updated_at
  `);
  const del = db.prepare('DELETE FROM pagamentos WHERE ano=? AND mes=? AND nome=?');
  const tx = db.transaction(() => {
    for (const r of registros) {
      if (r.dia) upsert.run(r.ano, r.mes, r.nome, r.dia);
      else del.run(r.ano, r.mes, r.nome);
    }
  });
  tx();
  res.json({ ok: true, count: registros.length });
});

// ── API CONFIG ──────────────────────────────────────────────────────────────

app.get('/api/config', (req, res) => {
  const rows = db.prepare('SELECT chave, valor FROM config').all();
  const cfg = {};
  for (const r of rows) {
    try { cfg[r.chave] = JSON.parse(r.valor); } catch(e) { cfg[r.chave] = r.valor; }
  }
  res.json(cfg);
});

app.post('/api/config', (req, res) => {
  const { chave, valor } = req.body;
  db.prepare(`
    INSERT INTO config (chave, valor, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor, updated_at=excluded.updated_at
  `).run(chave, JSON.stringify(valor));
  res.json({ ok: true });
});

// ── API COMPROVANTES ────────────────────────────────────────────────────────

app.get('/api/comprovantes', (req, res) => {
  const rows = db.prepare('SELECT * FROM comprovantes ORDER BY id DESC LIMIT 200').all();
  res.json(rows);
});

app.post('/api/comprovantes', (req, res) => {
  const { nome, mes, ano, dia, valor, gerado_em } = req.body;
  db.prepare('INSERT INTO comprovantes (nome, mes, ano, dia, valor, gerado_em) VALUES (?, ?, ?, ?, ?, ?)').run(nome, mes, ano, dia, valor, gerado_em);
  res.json({ ok: true });
});

app.delete('/api/comprovantes', (req, res) => {
  db.prepare('DELETE FROM comprovantes').run();
  res.json({ ok: true });
});

// Fallback → index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`NIQ servidor rodando na porta ${PORT}`));

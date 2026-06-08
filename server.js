const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Diretório de dados persistente no Render
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'db.json');

// ─── BANCO DE DADOS (JSON em disco) ─────────────────────────────────────────
function readDB() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch(e) { console.error('Erro ao ler DB:', e.message); }
  return { pagamentos: {}, config: {}, comprovantes: [] };
}

function writeDB(data) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }
  catch(e) { console.error('Erro ao salvar DB:', e.message); }
}

// Seed dados iniciais se banco estiver vazio
function seedIfEmpty(db) {
  if (Object.keys(db.pagamentos).length > 0) return;
  const dados = {
    "2026": {
      "2": {"Andrei Rossetti":10,"Jarbas Junior de Matos":10,"Maicon Luis Simoneti":10,"Cleiton Aloisio Becker":10,"Eliane dos Santos":10,"Marcos Pilz":10,"Gabriela Peretti":10,"Leomir Borghardt":10,"Joceli Nepomuceno":10,"Lilian Aparecida Comparin":10,"Bruno Henrique Pedrolo de Souza":10,"Aline Romilda dos Santos Pituco":10,"Juliana Paulus":10,"Renan Antônio Breansini":10},
      "3": {"Andrei Rossetti":10,"Jarbas Junior de Matos":10,"Maicon Luis Simoneti":10,"Cleiton Aloisio Becker":10,"Eliane dos Santos":10,"Marcos Pilz":10,"Gabriela Peretti":10,"Leomir Borghardt":10,"Joceli Nepomuceno":10,"Lilian Aparecida Comparin":10,"Bruno Henrique Pedrolo de Souza":10,"Aline Romilda dos Santos Pituco":10,"Juliana Paulus":10,"Renan Antônio Breansini":10,"Yuri Signorati":10},
      "4": {"Jarbas Junior de Matos":10,"Maicon Luis Simoneti":10,"Cleiton Aloisio Becker":10,"Eliane dos Santos":10,"Marcos Pilz":10,"Leomir Borghardt":10,"Joceli Nepomuceno":10,"Bruno Henrique Pedrolo de Souza":10,"Aline Romilda dos Santos Pituco":10,"Juliana Paulus":10,"Renan Antônio Breansini":10,"Yuri Signorati":10},
      "5": {"Jarbas Junior de Matos":10,"Maicon Luis Simoneti":10,"Cleiton Aloisio Becker":10,"Eliane dos Santos":10,"Marcos Pilz":10,"Leomir Borghardt":10,"Joceli Nepomuceno":10,"Bruno Henrique Pedrolo de Souza":10,"Aline Romilda dos Santos Pituco":10,"Juliana Paulus":10,"Renan Antônio Breansini":10},
      "6": {"Jarbas Junior de Matos":10,"Eliane dos Santos":10,"Joceli Nepomuceno":10},
      "7": {"Jarbas Junior de Matos":10,"Eliane dos Santos":10,"Joceli Nepomuceno":10},
      "8": {"Jarbas Junior de Matos":10,"Eliane dos Santos":10,"Joceli Nepomuceno":10},
      "9": {"Jarbas Junior de Matos":10,"Eliane dos Santos":10,"Joceli Nepomuceno":10},
      "10": {"Jarbas Junior de Matos":10,"Eliane dos Santos":10,"Joceli Nepomuceno":10},
      "11": {"Jarbas Junior de Matos":10,"Eliane dos Santos":10,"Joceli Nepomuceno":10},
      "12": {"Jarbas Junior de Matos":10,"Eliane dos Santos":10,"Joceli Nepomuceno":10}
    }
  };
  db.pagamentos = dados;
  writeDB(db);
  console.log('Dados iniciais inseridos.');
}

let db = readDB();
seedIfEmpty(db);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── API PAGAMENTOS ──────────────────────────────────────────────────────────
app.get('/api/pagamentos/:ano', (req, res) => {
  const ano = req.params.ano;
  res.json(db.pagamentos[ano] || {});
});

app.post('/api/pagamentos', (req, res) => {
  const { ano, mes, nome, dia } = req.body;
  if (!ano || !mes || !nome) return res.status(400).json({ error: 'Dados incompletos' });
  const a = String(ano), m = String(mes);
  if (!db.pagamentos[a]) db.pagamentos[a] = {};
  if (!db.pagamentos[a][m]) db.pagamentos[a][m] = {};
  if (dia) db.pagamentos[a][m][nome] = dia;
  else delete db.pagamentos[a][m][nome];
  writeDB(db);
  res.json({ ok: true });
});

app.post('/api/pagamentos/bulk', (req, res) => {
  const { registros } = req.body;
  if (!Array.isArray(registros)) return res.status(400).json({ error: 'Inválido' });
  for (const r of registros) {
    const a = String(r.ano), m = String(r.mes);
    if (!db.pagamentos[a]) db.pagamentos[a] = {};
    if (!db.pagamentos[a][m]) db.pagamentos[a][m] = {};
    if (r.dia) db.pagamentos[a][m][r.nome] = r.dia;
    else delete db.pagamentos[a][m][r.nome];
  }
  writeDB(db);
  res.json({ ok: true, count: registros.length });
});

// ─── API CONFIG ──────────────────────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  res.json(db.config || {});
});

app.post('/api/config', (req, res) => {
  const { chave, valor } = req.body;
  if (!chave) return res.status(400).json({ error: 'Chave obrigatória' });
  if (!db.config) db.config = {};
  db.config[chave] = valor;
  writeDB(db);
  res.json({ ok: true });
});

// ─── API COMPROVANTES ────────────────────────────────────────────────────────
app.get('/api/comprovantes', (req, res) => {
  res.json((db.comprovantes || []).slice(0, 200));
});

app.post('/api/comprovantes', (req, res) => {
  if (!db.comprovantes) db.comprovantes = [];
  db.comprovantes.unshift(req.body);
  if (db.comprovantes.length > 200) db.comprovantes.splice(200);
  writeDB(db);
  res.json({ ok: true });
});

app.delete('/api/comprovantes', (req, res) => {
  db.comprovantes = [];
  writeDB(db);
  res.json({ ok: true });
});

// Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`NIQ rodando na porta ${PORT}`));

const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// GitHub config - set these as environment variables in Render
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO; // ex: BrunoPedrolo/niq-mensalidades
const GITHUB_FILE = process.env.GITHUB_FILE || 'data/db.json';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

// In-memory cache
let memDB = null;
let dbSha = null;

// ─── GITHUB API ──────────────────────────────────────────────────────────────
function githubRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: urlPath,
      method: method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'niq-mensalidades',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function loadFromGitHub() {
  if (!GITHUB_TOKEN) return getDefaultDB();
  try {
    const res = await githubRequest('GET', `/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}?ref=${GITHUB_BRANCH}`);
    if (res.status === 200) {
      dbSha = res.body.sha;
      const content = Buffer.from(res.body.content, 'base64').toString('utf8');
      return JSON.parse(content);
    }
  } catch(e) { console.error('Erro ao carregar do GitHub:', e.message); }
  return getDefaultDB();
}

async function saveToGitHub(db) {
  if (!GITHUB_TOKEN) return;
  try {
    const content = Buffer.from(JSON.stringify(db, null, 2)).toString('base64');
    const body = {
      message: 'update db',
      content,
      branch: GITHUB_BRANCH
    };
    if (dbSha) body.sha = dbSha;
    const res = await githubRequest('PUT', `/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`, body);
    if (res.status === 200 || res.status === 201) {
      dbSha = res.body.content?.sha;
      console.log('Dados salvos no GitHub');
    } else {
      console.error('Erro ao salvar:', res.status, res.body.message);
    }
  } catch(e) { console.error('Erro ao salvar no GitHub:', e.message); }
}

function getDefaultDB() {
  return {
    pagamentos: {
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
    },
    config: {},
    comprovantes: []
  };
}

// Initialize
async function init() {
  console.log('Carregando dados do GitHub...');
  memDB = await loadFromGitHub();
  console.log('Dados carregados!');
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── API PAGAMENTOS ──────────────────────────────────────────────────────────
app.get('/api/pagamentos/:ano', (req, res) => {
  const ano = req.params.ano;
  res.json((memDB.pagamentos && memDB.pagamentos[ano]) ? memDB.pagamentos[ano] : {});
});

app.post('/api/pagamentos', async (req, res) => {
  const { ano, mes, nome, dia } = req.body;
  if (!ano || !mes || !nome) return res.status(400).json({ error: 'Dados incompletos' });
  const a = String(ano), m = String(mes);
  if (!memDB.pagamentos[a]) memDB.pagamentos[a] = {};
  if (!memDB.pagamentos[a][m]) memDB.pagamentos[a][m] = {};
  if (dia) memDB.pagamentos[a][m][nome] = dia;
  else delete memDB.pagamentos[a][m][nome];
  await saveToGitHub(memDB);
  res.json({ ok: true });
});

app.post('/api/pagamentos/bulk', async (req, res) => {
  const { registros } = req.body;
  if (!Array.isArray(registros)) return res.status(400).json({ error: 'Inválido' });
  for (const r of registros) {
    const a = String(r.ano), m = String(r.mes);
    if (!memDB.pagamentos[a]) memDB.pagamentos[a] = {};
    if (!memDB.pagamentos[a][m]) memDB.pagamentos[a][m] = {};
    if (r.dia) memDB.pagamentos[a][m][r.nome] = r.dia;
    else delete memDB.pagamentos[a][m][r.nome];
  }
  await saveToGitHub(memDB);
  res.json({ ok: true, count: registros.length });
});

// ─── API CONFIG ──────────────────────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  res.json(memDB.config || {});
});

app.post('/api/config', async (req, res) => {
  const { chave, valor } = req.body;
  if (!chave) return res.status(400).json({ error: 'Chave obrigatória' });
  if (!memDB.config) memDB.config = {};
  memDB.config[chave] = valor;
  await saveToGitHub(memDB);
  res.json({ ok: true });
});

// ─── API COMPROVANTES ────────────────────────────────────────────────────────
app.get('/api/comprovantes', (req, res) => {
  res.json((memDB.comprovantes || []).slice(0, 200));
});

app.post('/api/comprovantes', async (req, res) => {
  if (!memDB.comprovantes) memDB.comprovantes = [];
  memDB.comprovantes.unshift(req.body);
  if (memDB.comprovantes.length > 200) memDB.comprovantes.splice(200);
  await saveToGitHub(memDB);
  res.json({ ok: true });
});

app.delete('/api/comprovantes', async (req, res) => {
  memDB.comprovantes = [];
  await saveToGitHub(memDB);
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

init().then(() => {
  app.listen(PORT, () => console.log(`NIQ rodando na porta ${PORT}`));
});

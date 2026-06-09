const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_REPO   = process.env.GITHUB_REPO  || 'BrunoPedrolo/niq-mensalidades';
const GITHUB_FILE   = process.env.GITHUB_FILE  || 'data/db.json';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

let memDB = null;
let dbSha = null;

// ─── GITHUB ──────────────────────────────────────────────────────────────────
function githubRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.github.com',
      path: urlPath,
      method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'niq-mensalidades',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch(e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function loadFromGitHub() {
  if (!GITHUB_TOKEN) {
    console.log('AVISO: GITHUB_TOKEN não configurado — usando dados padrão');
    return null;
  }
  try {
    const res = await githubRequest('GET', `/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}?ref=${GITHUB_BRANCH}`);
    if (res.status === 200) {
      dbSha = res.body.sha;
      const content = Buffer.from(res.body.content, 'base64').toString('utf8');
      console.log('Dados carregados do GitHub. SHA:', dbSha);
      return JSON.parse(content);
    } else {
      console.log('GitHub retornou status', res.status, '— arquivo não encontrado, usando padrão');
      return null;
    }
  } catch(e) {
    console.error('Erro ao carregar do GitHub:', e.message);
    return null;
  }
}

async function saveToGitHub(db) {
  if (!GITHUB_TOKEN) {
    console.log('AVISO: GITHUB_TOKEN não configurado — dados não salvos');
    return false;
  }
  try {
    const content = Buffer.from(JSON.stringify(db, null, 2)).toString('base64');
    const body = { message: 'update db', content, branch: GITHUB_BRANCH };
    if (dbSha) body.sha = dbSha;

    const res = await githubRequest('PUT', `/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`, body);

    if (res.status === 200 || res.status === 201) {
      dbSha = res.body.content && res.body.content.sha;
      console.log('Dados salvos no GitHub. Novo SHA:', dbSha);
      return true;
    } else {
      console.error('Erro ao salvar no GitHub. Status:', res.status, 'Msg:', res.body.message || res.body);
      // Se SHA inválido, tenta buscar o SHA atual e salvar novamente
      if (res.status === 409 || res.status === 422) {
        console.log('Conflito de SHA — buscando SHA atual...');
        const r2 = await githubRequest('GET', `/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}?ref=${GITHUB_BRANCH}`);
        if (r2.status === 200) {
          dbSha = r2.body.sha;
          body.sha = dbSha;
          const r3 = await githubRequest('PUT', `/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`, body);
          if (r3.status === 200 || r3.status === 201) {
            dbSha = r3.body.content && r3.body.content.sha;
            console.log('Salvo após retry. SHA:', dbSha);
            return true;
          }
        }
      }
      return false;
    }
  } catch(e) {
    console.error('Exceção ao salvar no GitHub:', e.message);
    return false;
  }
}

function getDefaultDB() {
  return {
    pagamentos: {
      "2026": {
        "2": {"Andrei Rossetti":10,"Jarbas Junior de Matos":10,"Maicon Luis Simoneti":10,"Cleiton Aloisio Becker":10,"Eliane dos Santos":10,"Marcos Pilz":10,"Gabriela Peretti":10,"Leomir Borghardt":10,"Joceli Nepomuceno":10,"Lilian Aparecida Comparin":10,"Bruno Henrique Pedrolo de Souza":10,"Aline Romilda dos Santos Pituco":10,"Juliana Paulus":10,"Renan Antônio Breansini":10},
        "3": {"Andrei Rossetti":10,"Jarbas Junior de Matos":10,"Maicon Luis Simoneti":10,"Cleiton Aloisio Becker":10,"Eliane dos Santos":10,"Marcos Pilz":10,"Gabriela Peretti":10,"Leomir Borghardt":10,"Joceli Nepomuceno":10,"Lilian Aparecida Comparin":10,"Bruno Henrique Pedrolo de Souza":10,"Aline Romilda dos Santos Pituco":10,"Juliana Paulus":10,"Renan Antônio Breansini":10,"Yuri Signorati":10},
        "4": {"Jarbas Junior de Matos":10,"Maicon Luis Simoneti":10,"Cleiton Aloisio Becker":10,"Eliane dos Santos":10,"Marcos Pilz":10,"Leomir Borghardt":10,"Joceli Nepomuceno":10,"Bruno Henrique Pedrolo de Souza":10,"Aline Romilda dos Santos Pituco":10,"Juliana Paulus":10,"Renan Antônio Breansini":10,"Yuri Signorati":10},
        "5": {"Jarbas Junior de Matos":10,"Maicon Luis Simoneti":10,"Cleiton Aloisio Becker":10,"Eliane dos Santos":10,"Marcos Pilz":10,"Leomir Borghardt":10,"Joceli Nepomuceno":10,"Bruno Henrique Pedrolo de Souza":10,"Aline Romilda dos Santos Pituco":10,"Juliana Paulus":10,"Renan Antônio Breansini":10},
        "6": {"Jarbas Junior de Matos":10,"Eliane dos Santos":10,"Joceli Nepomuceno":10,"Bruno Henrique Pedrolo de Souza":4,"Juliana Paulus":7},
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

async function init() {
  console.log('=== NIQ Mensalidades iniciando ===');
  console.log('GITHUB_TOKEN configurado:', !!GITHUB_TOKEN);
  console.log('GITHUB_REPO:', GITHUB_REPO);
  console.log('GITHUB_FILE:', GITHUB_FILE);

  const fromGitHub = await loadFromGitHub();
  memDB = fromGitHub || getDefaultDB();

  if (!fromGitHub) {
    console.log('Usando dados padrão. Tentando salvar no GitHub...');
    await saveToGitHub(memDB);
  }
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── API ─────────────────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    github_token: !!GITHUB_TOKEN,
    github_repo: GITHUB_REPO,
    github_file: GITHUB_FILE,
    db_sha: dbSha,
    membros_junho: Object.keys((memDB.pagamentos?.['2026']?.['6']) || {}).length
  });
});

app.get('/api/pagamentos/:ano', (req, res) => {
  const ano = req.params.ano;
  const raw = (memDB.pagamentos && memDB.pagamentos[ano]) ? memDB.pagamentos[ano] : {};
  const result = {};
  for (const [mes, dados] of Object.entries(raw)) {
    result[parseInt(mes)] = dados;
  }
  res.json(result);
});

app.post('/api/pagamentos', async (req, res) => {
  const { ano, mes, nome, dia } = req.body;
  if (!ano || !mes || !nome) return res.status(400).json({ error: 'Dados incompletos' });
  const a = String(ano), m = String(mes);
  if (!memDB.pagamentos[a]) memDB.pagamentos[a] = {};
  if (!memDB.pagamentos[a][m]) memDB.pagamentos[a][m] = {};
  if (dia) memDB.pagamentos[a][m][nome] = dia;
  else delete memDB.pagamentos[a][m][nome];
  const saved = await saveToGitHub(memDB);
  res.json({ ok: true, saved });
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
  const saved = await saveToGitHub(memDB);
  res.json({ ok: true, count: registros.length, saved });
});

app.get('/api/config', (req, res) => res.json(memDB.config || {}));

app.post('/api/config', async (req, res) => {
  const { chave, valor } = req.body;
  if (!chave) return res.status(400).json({ error: 'Chave obrigatória' });
  if (!memDB.config) memDB.config = {};
  memDB.config[chave] = valor;
  const saved = await saveToGitHub(memDB);
  res.json({ ok: true, saved });
});

app.get('/api/comprovantes', (req, res) => res.json((memDB.comprovantes || []).slice(0, 200)));

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

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

init().then(() => {
  app.listen(PORT, () => console.log(`NIQ rodando na porta ${PORT}`));
});

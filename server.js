'use strict';
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ─── CONFIGURAÇÃO (variáveis de ambiente no Render) ──────────────────────────
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'BrunoPedrolo/niq-mensalidades';
const GITHUB_FILE = process.env.GITHUB_FILE || 'data/db.json';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const LOCAL_DB = process.env.LOCAL_DB || ''; // só para testes locais

const SENHA_TES = process.env.SENHA_TESOURARIA || 'nucleo2026';
const SENHA_TES_PADRAO = !process.env.SENHA_TESOURARIA;
const SENHA_COORD = process.env.SENHA_COORDENACAO || '';

// ─── SESSÃO (token assinado, sobrevive a reinício do servidor) ───────────────
const SECRET = process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update(['niq', SENHA_TES, SENHA_COORD, GITHUB_TOKEN || ''].join('|')).digest('hex');
const SESSION_MS = 12 * 60 * 60 * 1000;
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function makeToken(perfil) {
  const body = b64u(JSON.stringify({ p: perfil, e: Date.now() + SESSION_MS }));
  return body + '.' + sign(body);
}
function readToken(tok) {
  if (!tok || typeof tok !== 'string') return null;
  const parts = tok.split('.');
  if (parts.length !== 2) return null;
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(sign(parts[0]));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const o = JSON.parse(Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    if (!o.e || o.e < Date.now()) return null;
    return o;
  } catch (e) { return null; }
}
function eqPass(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function perfilDaSenha(senha) {
  if (eqPass(senha, SENHA_TES)) return 'tesoureiro';
  if (SENHA_COORD && eqPass(senha, SENHA_COORD)) return 'coordenacao';
  return null;
}

// limite de tentativas de senha (por IP)
const fails = new Map();
const tooMany = (ip) => { const f = fails.get(ip); return !!(f && f.until && f.until > Date.now()); };
function registerFail(ip) {
  const now = Date.now();
  let f = fails.get(ip);
  if (!f || now - f.first > 10 * 60 * 1000) f = { n: 0, first: now, until: 0 };
  f.n++;
  if (f.n >= 8) f.until = now + 10 * 60 * 1000;
  fails.set(ip, f);
}

function auth(...perfis) {
  return (req, res, next) => {
    const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const s = readToken(tok);
    if (!s) return res.status(401).json({ error: 'Sessão inválida ou expirada' });
    if (perfis.length && !perfis.includes(s.p)) return res.status(403).json({ error: 'Sem permissão' });
    req.perfil = s.p;
    next();
  };
}

// ─── BANCO DE DADOS (arquivo JSON no GitHub) ─────────────────────────────────
let memDB = null;     // só fica preenchido depois de carregar com sucesso
let dbSha = null;
let ready = false;
let lastSave = { ok: null, at: null, msg: '' };

function githubRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com', path: urlPath, method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'niq-mensalidades',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let raw = '';
      res.on('data', (c) => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    if (data) req.write(data);
    req.end();
  });
}

// retorna {status:'ok',db} | {status:'missing'} | {status:'error'}
async function loadRemote() {
  if (LOCAL_DB) {
    try { return { status: 'ok', db: JSON.parse(fs.readFileSync(LOCAL_DB, 'utf8')) }; }
    catch (e) { return e.code === 'ENOENT' ? { status: 'missing' } : { status: 'error' }; }
  }
  if (!GITHUB_TOKEN) return { status: 'missing' };
  try {
    const res = await githubRequest('GET', `/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}?ref=${GITHUB_BRANCH}`);
    if (res.status === 200) {
      dbSha = res.body.sha;
      let content;
      if (res.body.content) content = Buffer.from(res.body.content, 'base64').toString('utf8');
      else { // arquivo grande: baixa pelo blob
        const b = await githubRequest('GET', `/repos/${GITHUB_REPO}/git/blobs/${res.body.sha}`);
        content = Buffer.from(b.body.content, 'base64').toString('utf8');
      }
      return { status: 'ok', db: JSON.parse(content) };
    }
    if (res.status === 404) return { status: 'missing' };
    console.error('GitHub respondeu', res.status, res.body && res.body.message);
    return { status: 'error' };
  } catch (e) {
    console.error('Erro ao ler do GitHub:', e.message);
    return { status: 'error' };
  }
}

async function doSave() {
  const text = JSON.stringify(memDB, null, 2);
  if (LOCAL_DB) {
    try { fs.writeFileSync(LOCAL_DB, text); lastSave = { ok: true, at: new Date().toISOString(), msg: 'local' }; return true; }
    catch (e) { lastSave = { ok: false, at: new Date().toISOString(), msg: e.message }; return false; }
  }
  if (!GITHUB_TOKEN) { lastSave = { ok: false, at: new Date().toISOString(), msg: 'GITHUB_TOKEN ausente' }; return false; }
  try {
    const content = Buffer.from(text).toString('base64');
    // "[skip render]" evita que cada gravação dispare um novo deploy no Render
    const body = { message: 'update db [skip render]', content, branch: GITHUB_BRANCH };
    if (dbSha) body.sha = dbSha;
    let res = await githubRequest('PUT', `/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`, body);
    if (res.status === 409 || res.status === 422) { // SHA desatualizado: pega o atual e tenta de novo
      const cur = await githubRequest('GET', `/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}?ref=${GITHUB_BRANCH}`);
      if (cur.status === 200) { body.sha = cur.body.sha; res = await githubRequest('PUT', `/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`, body); }
    }
    if (res.status === 200 || res.status === 201) {
      dbSha = res.body.content && res.body.content.sha;
      lastSave = { ok: true, at: new Date().toISOString(), msg: '' };
      return true;
    }
    lastSave = { ok: false, at: new Date().toISOString(), msg: `GitHub ${res.status}: ${(res.body && res.body.message) || ''}` };
    console.error('Erro ao salvar:', lastSave.msg);
    return false;
  } catch (e) {
    lastSave = { ok: false, at: new Date().toISOString(), msg: e.message };
    console.error('Exceção ao salvar:', e.message);
    return false;
  }
}

// grava em fila: nunca duas gravações ao mesmo tempo, e pedidos seguidos viram uma só
let chain = Promise.resolve();
let waiting = null;
function persist() {
  if (waiting) return waiting;
  waiting = chain.then(() => { waiting = null; return doSave(); });
  chain = waiting.catch(() => {});
  return waiting;
}

function defaultDB() {
  const p = (nomes) => nomes.reduce((o, n) => { o[n] = 10; return o; }, {});
  const base = ['Andrei Rossetti', 'Jarbas Junior de Matos', 'Maicon Luis Simoneti', 'Cleiton Aloisio Becker', 'Eliane dos Santos', 'Marcos Pilz', 'Gabriela Peretti', 'Leomir Borghardt', 'Joceli Nepomuceno', 'Lilian Aparecida Comparin', 'Bruno Henrique Pedrolo de Souza', 'Aline Romilda dos Santos Pituco', 'Juliana Paulus', 'Renan Antônio Breansini'];
  const ano = ['Jarbas Junior de Matos', 'Eliane dos Santos', 'Joceli Nepomuceno'];
  const pg = { '2': p(base), '3': p(base.concat(['Yuri Signorati'])) };
  const m45 = base.filter((n) => !['Andrei Rossetti', 'Gabriela Peretti', 'Lilian Aparecida Comparin'].includes(n));
  pg['4'] = p(m45.concat(['Yuri Signorati']));
  pg['5'] = p(m45);
  for (let m = 6; m <= 12; m++) pg[String(m)] = p(ano);
  return { pagamentos: { '2026': pg }, config: {}, comprovantes: [] };
}

// completa campos novos sem mexer no que já existe
function migrate(db) {
  if (!db || typeof db !== 'object') db = {};
  db.pagamentos = db.pagamentos || {};
  db.config = db.config || {};
  db.comprovantes = Array.isArray(db.comprovantes) ? db.comprovantes : [];
  const c = db.config;
  if (!c.mensalidades || typeof c.mensalidades !== 'object') c.mensalidades = { '2026': 25, '2027': 30 };
  c.inicio = c.inicio || {};
  if (!c.inicio['Yuri Signorati']) c.inicio['Yuri Signorati'] = { ano: 2026, mes: 3 };
  c.inativoDesde = c.inativoDesde || {};
  if (!c.tesoureiroNome) c.tesoureiroNome = 'Bruno Henrique Pedrolo de Souza';
  const f = db.financeiro = db.financeiro || {};
  f.abertura = f.abertura || { data: '2026-02-01', conta: 0, aplicacao: 0, definido: false };
  f.categorias = Array.isArray(f.categorias) ? f.categorias : ['Evento', 'Despesa operacional', 'Rendimento', 'Outros'];
  f.eventos = Array.isArray(f.eventos) ? f.eventos : [];
  f.movimentos = Array.isArray(f.movimentos) ? f.movimentos : [];
  f.extratos = f.extratos || {};
  if (!Array.isArray(f.antecipacoes)) {
    // quem pagou o ano todo em fevereiro/2026 (recebimento em caixa em 10/02)
    f.antecipacoes = ['Jarbas Junior de Matos', 'Eliane dos Santos', 'Joceli Nepomuceno']
      .map((n, i) => ({ id: 'ant-seed-' + i, nome: n, ano: 2026, recebidoEm: '2026-02-10', de: 2, ate: 12 }));
  }
  return db;
}

async function initDB() {
  for (let i = 0; i < 5; i++) {
    const r = await loadRemote();
    if (r.status === 'ok') { memDB = migrate(r.db); ready = true; console.log('Dados carregados.'); return; }
    if (r.status === 'missing') {
      memDB = migrate(defaultDB()); ready = true;
      console.log('Sem base anterior: criando com dados iniciais.');
      await persist();
      return;
    }
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
  // Não conseguiu ler: NÃO grava nada (evita sobrescrever dados reais) e tenta de novo depois.
  console.error('Banco indisponível. Novas tentativas a cada 15s; gravações bloqueadas.');
  setTimeout(initDB, 15000);
}

// ─── MIDDLEWARES ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, p) => { if (p.endsWith('.html')) res.set('Cache-Control', 'no-cache'); }
}));
const needReady = (req, res, next) => ready ? next() : res.status(503).json({ error: 'Banco de dados indisponível no momento' });

const isInt = (v, a, b) => Number.isInteger(v) && v >= a && v <= b;
const dataValida = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s && +s.slice(0, 4) >= 2020 && +s.slice(0, 4) <= 2100;
const str = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

// ─── ROTAS PÚBLICAS ──────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({ ok: true, pronto: ready, github_token: !!GITHUB_TOKEN, ultimo_salvamento: lastSave });
});

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (tooMany(ip)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
  const perfil = perfilDaSenha((req.body && req.body.senha) || '');
  if (!perfil) { registerFail(ip); return res.status(401).json({ error: 'Senha incorreta' }); }
  fails.delete(ip);
  res.json({ ok: true, perfil, token: makeToken(perfil), expira_em_horas: SESSION_MS / 3600000 });
});

app.get('/api/dados', needReady, (req, res) => {
  res.json({ pagamentos: memDB.pagamentos, config: memDB.config });
});

// ─── TESOUREIRO ──────────────────────────────────────────────────────────────
app.get('/api/auth/status', auth('tesoureiro'), (req, res) => {
  res.json({
    tesouraria_padrao: SENHA_TES_PADRAO,
    coordenacao_configurada: !!SENHA_COORD,
    github_token: !!GITHUB_TOKEN,
    ultimo_salvamento: lastSave,
    sessao_horas: SESSION_MS / 3600000
  });
});

app.post('/api/pagamentos/bulk', auth('tesoureiro'), needReady, async (req, res) => {
  const regs = req.body && req.body.registros;
  if (!Array.isArray(regs) || regs.length > 1000) return res.status(400).json({ error: 'Registros inválidos' });
  for (const r of regs) {
    // dia: número (dia do mês de referência), 'AAAA-MM-DD' (pago em outra data) ou null (remover)
    if (!isInt(r.ano, 2020, 2100) || !isInt(r.mes, 1, 12) || !str(r.nome, 120) || !(r.dia === null || isInt(r.dia, 1, 31) || dataValida(r.dia))) {
      return res.status(400).json({ error: 'Registro inválido' });
    }
  }
  for (const r of regs) {
    const a = String(r.ano), m = String(r.mes);
    memDB.pagamentos[a] = memDB.pagamentos[a] || {};
    memDB.pagamentos[a][m] = memDB.pagamentos[a][m] || {};
    if (r.dia) memDB.pagamentos[a][m][r.nome] = r.dia; else delete memDB.pagamentos[a][m][r.nome];
  }
  const saved = await persist();
  res.json({ ok: true, saved, count: regs.length });
});

app.put('/api/config', auth('tesoureiro'), needReady, async (req, res) => {
  const body = req.body || {};
  const cfg = body.config || {};
  const c = memDB.config;
  const isNomeMap = (o) => o && typeof o === 'object' && !Array.isArray(o);
  const okData = (d) => d && isInt(d.ano, 2020, 2100) && isInt(d.mes, 1, 12);

  if (cfg.lista !== undefined) {
    if (!Array.isArray(cfg.lista) || cfg.lista.length > 200 || !cfg.lista.every((n) => str(n, 120)) || new Set(cfg.lista).size !== cfg.lista.length) {
      return res.status(400).json({ error: 'Lista de nucleados inválida' });
    }
  }
  if (cfg.ativos !== undefined && (!Array.isArray(cfg.ativos) || !cfg.ativos.every((n) => str(n, 120)))) return res.status(400).json({ error: 'Ativos inválidos' });
  for (const k of ['inicio', 'inativoDesde']) {
    if (cfg[k] !== undefined) {
      if (!isNomeMap(cfg[k]) || !Object.values(cfg[k]).every(okData)) return res.status(400).json({ error: k + ' inválido' });
    }
  }
  if (cfg.mensalidades !== undefined) {
    if (!isNomeMap(cfg.mensalidades) || !Object.entries(cfg.mensalidades).every(([y, v]) => isInt(+y, 2020, 2100) && typeof v === 'number' && v > 0 && v < 100000)) {
      return res.status(400).json({ error: 'Valores de mensalidade inválidos' });
    }
  }
  if (cfg.tesoureiroNome !== undefined && !str(cfg.tesoureiroNome, 120)) return res.status(400).json({ error: 'Nome inválido' });

  const ren = body.renomear;
  if (ren) {
    if (!str(ren.de, 120) || !str(ren.para, 120)) return res.status(400).json({ error: 'Renomeação inválida' });
    for (const a of Object.keys(memDB.pagamentos)) {
      for (const m of Object.keys(memDB.pagamentos[a])) {
        const mm = memDB.pagamentos[a][m];
        if (Object.prototype.hasOwnProperty.call(mm, ren.de)) { mm[ren.para] = mm[ren.de]; delete mm[ren.de]; }
      }
    }
    memDB.comprovantes.forEach((x) => { if (x.nome === ren.de) x.nome = ren.para; });
    memDB.financeiro.antecipacoes.forEach((x) => { if (x.nome === ren.de) x.nome = ren.para; });
  }
  for (const k of ['lista', 'ativos', 'inicio', 'inativoDesde', 'mensalidades', 'tesoureiroNome']) {
    if (cfg[k] !== undefined) c[k] = cfg[k];
  }
  const saved = await persist();
  res.json({ ok: true, saved, pagamentos: memDB.pagamentos, config: memDB.config });
});

app.get('/api/comprovantes', auth('tesoureiro'), needReady, (req, res) => res.json(memDB.comprovantes.slice(0, 300)));

app.post('/api/comprovantes', auth('tesoureiro'), needReady, async (req, res) => {
  const e = req.body || {};
  if (!str(e.nome, 120) || !isInt(e.mes, 1, 12) || !isInt(e.ano, 2020, 2100) || !isInt(e.dia, 1, 31) || typeof e.valor !== 'number') {
    return res.status(400).json({ error: 'Comprovante inválido' });
  }
  const novo = { nome: e.nome, mes: e.mes, ano: e.ano, dia: e.dia, valor: e.valor, gerado_em: String(e.gerado_em || new Date().toLocaleString('pt-BR')).slice(0, 40) };
  if (e.pagoEm !== undefined) { if (!dataValida(e.pagoEm)) return res.status(400).json({ error: 'Data do pagamento inválida' }); novo.pagoEm = e.pagoEm; }
  memDB.comprovantes.unshift(novo);
  if (memDB.comprovantes.length > 300) memDB.comprovantes.length = 300;
  const saved = await persist();
  res.json({ ok: true, saved });
});

app.delete('/api/comprovantes', auth('tesoureiro'), needReady, async (req, res) => {
  memDB.comprovantes = [];
  const saved = await persist();
  res.json({ ok: true, saved });
});

app.get('/api/backup', auth('tesoureiro'), needReady, (req, res) => {
  res.set('Content-Disposition', `attachment; filename="niq-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(memDB);
});

// ─── FINANCEIRO (Tesoureiro e Coordenação) ───────────────────────────────────
app.get('/api/financeiro', auth('tesoureiro', 'coordenacao'), needReady, (req, res) => res.json(memDB.financeiro));

const reData = /^\d{4}-\d{2}-\d{2}$/;
const reYM = /^\d{4}-\d{2}$/;
const num2 = (v) => Math.round(Number(v) * 100) / 100;

app.post('/api/financeiro/op', auth('tesoureiro', 'coordenacao'), needReady, async (req, res) => {
  const b = req.body || {};
  const f = memDB.financeiro;
  const fail = (code, msg) => res.status(code).json({ error: msg });
  const fechado = (ym) => !!(f.extratos[ym] && f.extratos[ym].validado);
  const ymOf = (d) => d.slice(0, 7);

  switch (b.op) {
    case 'mov.save': {
      const m = b.mov || {};
      if (!str(m.id, 60) || !reData.test(m.data || '') || !['entrada', 'saida', 'transferencia'].includes(m.tipo) ||
          !['conta', 'aplicacao'].includes(m.conta) || !(Number(m.valor) > 0) || !str(m.descricao, 200)) return fail(400, 'Lançamento inválido');
      if (m.tipo === 'transferencia') {
        if (!['conta', 'aplicacao'].includes(m.contaDestino) || m.contaDestino === m.conta) return fail(400, 'Transferência inválida');
      }
      if (m.eventoId && !f.eventos.some((e) => e.id === m.eventoId)) return fail(400, 'Evento inexistente');
      const novo = {
        id: m.id, data: m.data, tipo: m.tipo, conta: m.conta, valor: num2(m.valor),
        categoria: m.tipo === 'transferencia' ? 'Transferência' : String(m.categoria || 'Outros').slice(0, 60),
        descricao: m.descricao.trim().slice(0, 200), eventoId: m.eventoId || null, obs: String(m.obs || '').slice(0, 300)
      };
      if (m.tipo === 'transferencia') novo.contaDestino = m.contaDestino;
      const idx = f.movimentos.findIndex((x) => x.id === m.id);
      if (idx >= 0 && fechado(ymOf(f.movimentos[idx].data))) return fail(423, 'O mês original deste lançamento está validado. Reabra o mês para alterar.');
      if (fechado(ymOf(novo.data))) return fail(423, 'Esse mês está validado. Reabra o mês para lançar.');
      if (idx >= 0) f.movimentos[idx] = novo; else f.movimentos.push(novo);
      if (novo.tipo !== 'transferencia' && !f.categorias.includes(novo.categoria) && novo.categoria !== 'Mensalidades') f.categorias.push(novo.categoria);
      break;
    }
    case 'mov.del': {
      const idx = f.movimentos.findIndex((x) => x.id === b.id);
      if (idx < 0) return fail(404, 'Lançamento não encontrado');
      if (fechado(ymOf(f.movimentos[idx].data))) return fail(423, 'Esse mês está validado. Reabra o mês para excluir.');
      f.movimentos.splice(idx, 1);
      break;
    }
    case 'evt.save': {
      const e = b.evento || {};
      if (!str(e.id, 60) || !str(e.nome, 120) || (e.data && !reData.test(e.data))) return fail(400, 'Evento inválido');
      const novo = { id: e.id, nome: e.nome.trim(), data: e.data || '', orcamento: num2(e.orcamento || 0), obs: String(e.obs || '').slice(0, 300) };
      const idx = f.eventos.findIndex((x) => x.id === e.id);
      if (idx >= 0) f.eventos[idx] = novo; else f.eventos.push(novo);
      break;
    }
    case 'evt.del': {
      if (f.movimentos.some((x) => x.eventoId === b.id)) return fail(409, 'Este evento tem lançamentos vinculados. Remova ou desvincule antes.');
      f.eventos = f.eventos.filter((x) => x.id !== b.id);
      break;
    }
    case 'abertura.set': {
      const a = b.abertura || {};
      if (!reData.test(a.data || '') || !Number.isFinite(Number(a.conta)) || !Number.isFinite(Number(a.aplicacao))) return fail(400, 'Saldos inválidos');
      if (Object.values(f.extratos).some((x) => x.validado)) return fail(423, 'Há meses validados. Reabra-os antes de alterar o saldo de abertura.');
      f.abertura = { data: a.data, conta: num2(a.conta), aplicacao: num2(a.aplicacao), definido: true };
      break;
    }
    case 'extrato.set': {
      if (!reYM.test(b.ym || '')) return fail(400, 'Mês inválido');
      if (fechado(b.ym)) return fail(423, 'Mês validado. Reabra para alterar.');
      const cv = b.conta === null || b.conta === '' || b.conta === undefined ? null : num2(b.conta);
      const av = b.aplicacao === null || b.aplicacao === '' || b.aplicacao === undefined ? null : num2(b.aplicacao);
      f.extratos[b.ym] = { conta: cv, aplicacao: av, obs: String(b.obs || '').slice(0, 300), validado: false };
      break;
    }
    case 'extrato.validar': {
      const e = f.extratos[b.ym];
      if (!reYM.test(b.ym || '') || !e || e.conta == null || e.aplicacao == null) return fail(400, 'Informe os saldos do extrato antes de validar');
      if (Math.abs(e.conta - Number(b.calcConta)) > 0.005 || Math.abs(e.aplicacao - Number(b.calcAplic)) > 0.005) return fail(422, 'Os saldos do extrato não batem com o calculado');
      Object.assign(e, { validado: true, validadoEm: new Date().toISOString(), validadoPor: req.perfil === 'tesoureiro' ? 'Tesoureiro' : 'Coordenação', calcConta: num2(b.calcConta), calcAplic: num2(b.calcAplic) });
      break;
    }
    case 'extrato.reabrir': {
      if (!perfilDaSenha(b.senha || '')) return fail(401, 'Senha incorreta');
      const e = f.extratos[b.ym];
      if (!e) return fail(404, 'Mês sem extrato');
      e.validado = false; e.reabertoEm = new Date().toISOString();
      delete e.calcConta; delete e.calcAplic;
      break;
    }
    case 'cat.add': {
      if (!str(b.nome, 60)) return fail(400, 'Nome inválido');
      if (!f.categorias.includes(b.nome.trim())) f.categorias.push(b.nome.trim());
      break;
    }
    case 'antec.set': {
      const l = b.lista;
      if (!Array.isArray(l) || !l.every((a) => str(a.id, 60) && str(a.nome, 120) && isInt(a.ano, 2020, 2100) && reData.test(a.recebidoEm || '') && isInt(a.de, 1, 12) && isInt(a.ate, 1, 12) && a.de <= a.ate)) return fail(400, 'Antecipações inválidas');
      f.antecipacoes = l.map((a) => ({ id: a.id, nome: a.nome, ano: a.ano, recebidoEm: a.recebidoEm, de: a.de, ate: a.ate }));
      break;
    }
    default: return fail(400, 'Operação desconhecida');
  }
  const saved = await persist();
  res.json({ ok: true, saved, financeiro: f });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((err, req, res, next) => { // JSON malformado etc.
  res.status(err.status || 400).json({ error: 'Requisição inválida' });
});

app.listen(PORT, () => {
  console.log(`NIQ rodando na porta ${PORT}`);
  console.log('Senha do tesoureiro:', SENHA_TES_PADRAO ? 'PADRÃO (defina SENHA_TESOURARIA)' : 'definida');
  console.log('Senha da coordenação:', SENHA_COORD ? 'definida' : 'NÃO definida (defina SENHA_COORDENACAO)');
  console.log('GITHUB_TOKEN:', GITHUB_TOKEN ? 'definido' : 'AUSENTE');
  initDB();
});

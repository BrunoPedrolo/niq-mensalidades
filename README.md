# NIQ — Sistema de Controle de Mensalidades

## Como publicar (GitHub + Render)

### 1. GitHub

1. Acesse [github.com](https://github.com) e crie uma conta (se não tiver)
2. Clique em **New repository**
3. Nome: `niq-mensalidades` → clique **Create repository**
4. Na página do repositório, clique em **uploading an existing file**
5. Arraste **todos os arquivos desta pasta** (server.js, package.json, render.yaml, public/, README.md, .gitignore)
6. Clique **Commit changes**

### 2. Render

1. Acesse [render.com](https://render.com) e crie uma conta gratuita
2. Clique **New +** → **Web Service**
3. Conecte sua conta do GitHub
4. Selecione o repositório `niq-mensalidades`
5. Render detecta automaticamente as configurações do `render.yaml`
6. Clique **Create Web Service**
7. Aguarde ~2 minutos — seu sistema estará online!

### URL de acesso
Após publicar, você receberá uma URL tipo:
`https://niq-mensalidades.onrender.com`

Qualquer pessoa com esse link acessa o sistema de qualquer dispositivo.

### Dados
Os dados ficam salvos no servidor Render em um disco persistente.
**Não são perdidos** quando o servidor reinicia.

### Senha do tesoureiro
`nucleo2026`
> Pode ser alterada no arquivo `server.js` na linha: `const SENHA = 'nucleo2026'`

---
Desenvolvido para o Núcleo de Inovação e Qualidade — ACIP Pinhalzinho

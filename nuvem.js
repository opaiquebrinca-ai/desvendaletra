"use strict";
// Conta do jogador no Supabase (só apelido + senha) e estatísticas na nuvem.
// Fala direto com a API (sem biblioteca), para o jogo continuar abrindo offline.
const NUVEM = (() => {
  const URL_SUPA = "https://owfzktymperfkcmlaqmu.supabase.co";
  const CHAVE = "sb_publishable_O8lV5QJpxxHT75eVZTWGqA_hKP-1Nh0"; // chave pública: feita para ficar no app
  const DOMINIO = "desvendaletra.invalid";

  const ler = (k, p) => { try { const v = localStorage.getItem("jt:" + k); return v ? JSON.parse(v) : p; } catch { return p; } };
  const gravar = (k, v) => { try { if (v == null) localStorage.removeItem("jt:" + k); else localStorage.setItem("jt:" + k, JSON.stringify(v)); } catch { /* sem armazenamento */ } };

  let sessao = ler("sessao", null); // {access_token, refresh_token, expira, id, apelido}

  async function pedir(caminho, { metodo = "POST", corpo, token, extras = {} } = {}) {
    const h = { apikey: CHAVE, "Content-Type": "application/json", ...extras };
    if (token) h.Authorization = "Bearer " + token;
    let r;
    try {
      r = await fetch(URL_SUPA + caminho, { method: metodo, headers: h, body: corpo ? JSON.stringify(corpo) : undefined });
    } catch {
      throw new Error("Sem internet. Tente de novo quando estiver conectado.");
    }
    const texto = await r.text();
    let dados = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch { dados = texto; }
    if (!r.ok) {
      const msg = dados?.erro || dados?.msg || dados?.message || dados?.error_description || "Algo deu errado. Tente de novo.";
      const e = new Error(/invalid login credentials/i.test(msg) ? "Apelido ou senha não confere" : msg);
      e.status = r.status;
      throw e;
    }
    return dados;
  }

  function guardarSessao(d, apelido) {
    sessao = {
      access_token: d.access_token, refresh_token: d.refresh_token,
      expira: Date.now() + (d.expires_in || 3600) * 1000,
      id: d.user?.id || sessao?.id,
      apelido: apelido || d.user?.user_metadata?.apelido || sessao?.apelido,
    };
    gravar("sessao", sessao);
  }

  async function token() {
    if (!sessao) return null;
    if (Date.now() < sessao.expira - 60_000) return sessao.access_token;
    try {
      const d = await pedir("/auth/v1/token?grant_type=refresh_token", { corpo: { refresh_token: sessao.refresh_token } });
      guardarSessao(d);
      return sessao.access_token;
    } catch (e) {
      if (e.status === 400 || e.status === 401) { sair(); } // sessão vencida de vez
      throw e;
    }
  }

  const funcao = (corpo, tok) => pedir("/functions/v1/conta", { corpo, token: tok });

  async function entrar(apelido, senha) {
    const d = await pedir("/auth/v1/token?grant_type=password", {
      corpo: { email: `${apelido.trim().toLowerCase()}@${DOMINIO}`, password: senha },
    });
    guardarSessao(d, d.user?.user_metadata?.apelido || apelido.trim());
    return sessao;
  }

  async function cadastrar(apelido, senha) {
    const r = await funcao({ acao: "cadastrar", apelido: apelido.trim(), senha });
    await entrar(apelido, senha);
    return r.codigo;
  }

  async function recuperar(apelido, codigo, senha) {
    const r = await funcao({ acao: "recuperar", apelido: apelido.trim(), codigo, senha });
    await entrar(apelido, senha);
    return r.codigo;
  }

  async function novoCodigo() { return (await funcao({ acao: "novo_codigo" }, await token())).codigo; }

  async function apagarConta() {
    await funcao({ acao: "excluir" }, await token());
    sair();
  }

  function sair() { sessao = null; gravar("sessao", null); gravar("stats-conta", null); gravar("stats-pendente", null); }

  /* ---------- estatísticas ---------- */
  async function baixarStats() {
    const tok = await token();
    const linhas = await pedir(`/rest/v1/estatisticas?id=eq.${sessao.id}&select=dados`, { metodo: "GET", token: tok });
    return linhas?.[0]?.dados || null;
  }

  async function enviarStats(dados) {
    gravar("stats-pendente", true);
    const tok = await token();
    await pedir("/rest/v1/estatisticas?on_conflict=id", {
      corpo: { id: sessao.id, dados, atualizado_em: new Date().toISOString() }, token: tok,
      extras: { Prefer: "resolution=merge-duplicates,return=minimal" },
    });
    gravar("stats-pendente", null);
  }

  return {
    get logado() { return !!sessao; },
    get apelido() { return sessao?.apelido || null; },
    get pendente() { return !!ler("stats-pendente", false); },
    entrar, cadastrar, recuperar, novoCodigo, apagarConta, sair, baixarStats, enviarStats,
  };
})();

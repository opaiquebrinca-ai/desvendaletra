"use strict";
// Salas online: conversa com a função "sala" do servidor e fica de ouvido nas mudanças da sala.
// O aviso ao vivo vem pelo Realtime do Supabase (biblioteca carregada só quando se joga online);
// além disso, a cada 4 s o jogo confere o estado, para nunca ficar parado se o aviso falhar.
const ONLINE = (() => {
  const VERSAO_SUPABASE_JS = "2.49.4";
  let cliente = null, canal = null, relogio = null, codigoAtual = null, buscando = false;

  const chamar = (acao, extra = {}) => NUVEM.comLogin("sala", { acao, ...extra });

  function carregarBiblioteca() {
    if (window.supabase) return Promise.resolve();
    return new Promise((ok, falha) => {
      const s = document.createElement("script");
      s.src = `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${VERSAO_SUPABASE_JS}/dist/umd/supabase.js`;
      s.onload = ok; s.onerror = falha;
      document.head.appendChild(s);
    });
  }

  // Começa a escutar a sala; aoMudar recebe o estado novo (vindo do servidor).
  async function escutar(codigo, aoMudar, aoErro) {
    parar();
    codigoAtual = codigo;
    const atualizar = async () => {
      if (buscando || codigoAtual !== codigo) return;
      buscando = true;
      try { const e = await chamar("estado", { codigo }); if (codigoAtual === codigo) aoMudar(e); }
      catch (err) { if (codigoAtual === codigo) aoErro?.(err); }
      finally { buscando = false; }
    };
    relogio = setInterval(atualizar, 4000);
    atualizar();
    try {
      await carregarBiblioteca();
      if (codigoAtual !== codigo) return;
      cliente ??= window.supabase.createClient(NUVEM.URL, NUVEM.CHAVE, { auth: { persistSession: false } });
      canal = cliente.channel(`sala-${codigo}`).on("broadcast", { event: "mudou" }, atualizar).subscribe();
    } catch { /* sem o aviso ao vivo, a conferência a cada 4 s segura */ }
  }

  function parar() {
    codigoAtual = null;
    clearInterval(relogio); relogio = null;
    if (canal && cliente) { cliente.removeChannel(canal); }
    canal = null;
  }

  return {
    criar: (tamanho, nivel) => chamar("criar", { tamanho, nivel }),
    entrar: (codigo) => chamar("entrar", { codigo }),
    comecar: (codigo) => chamar("comecar", { codigo }),
    sair: (codigo) => chamar("sair", { codigo }),
    jogar: (codigo, palavra) => chamar("jogar", { codigo, palavra }),
    estado: (codigo) => chamar("estado", { codigo }),
    escutar, parar,
  };
})();

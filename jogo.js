"use strict";

const NIVEIS = {
  facil:   { nome: "Fácil",   tentativas: 20, mult: 1 },
  medio:   { nome: "Médio",   tentativas: 15, mult: 1.5 },
  dificil: { nome: "Difícil", tentativas: 10, mult: 2 },
};
const TAMANHOS = [4, 5, 6, 7];

/* ---------- pontuação: base pelo tamanho × nível × bônus de sequência ---------- */
const BASE_PONTOS = { 4: 100, 5: 150, 6: 220, 7: 300 };
const BONUS_SEQ_POR_VITORIA = 0.1, BONUS_SEQ_MAX = 0.5; // +10% por vitória seguida, até +50%
// seq = sequência já contando esta vitória (1 = primeira vitória seguida, sem bônus)
function calcularPontos(tamanho, nivel, seq = 1) {
  const base = BASE_PONTOS[tamanho] || 0;
  const mult = NIVEIS[nivel].mult;
  const bonus = Math.min(Math.max(seq - 1, 0) * BONUS_SEQ_POR_VITORIA, BONUS_SEQ_MAX);
  return { base, mult, bonus, total: Math.round(base * mult * (1 + bonus)) };
}
const numBR = n => n.toLocaleString("pt-BR");
const MODOS = { I: "Individual", D: "Dupla", M: "Online" };

const sem_acento = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

// Banco: { tamanho: Map(SEM_ACENTO -> Com Acento) }
const BANCO = {};
for (const p of PALAVRAS) {
  const k = sem_acento(p);
  if (!/^[A-Z]+$/.test(k) || k.length < 4 || k.length > 7) continue;
  (BANCO[k.length] ??= new Map()).set(k, p.toUpperCase());
}

/* ---------- armazenamento local (sempre com try/catch) ---------- */
const guarda = {
  ler(chave, padrao) {
    try { const v = localStorage.getItem("jt:" + chave); return v ? JSON.parse(v) : padrao; }
    catch { return padrao; }
  },
  gravar(chave, valor) {
    try { localStorage.setItem("jt:" + chave, JSON.stringify(valor)); } catch { /* sem armazenamento */ }
  },
};

const cfg = Object.assign(
  { nivel: "facil", tamanho: 5, simbolos: true, nome1: "Jogador 1", nome2: "Jogador 2" },
  guarda.ler("cfg", {})
);
// Estatísticas: sem conta ficam em "stats" (deste aparelho); com conta, em "stats-conta" + nuvem.
const statsVazias = () => ({
  I: { jogos: 0, vitorias: 0, seq: 0, melhor: 0, dist: {}, pontos: 0, recorde: 0 },
  D: { partidas: 0, empates: 0, vitorias: {}, pontos: {} },
  M: { partidas: 0, vitorias: 0, pontos: 0 },
});
const stats = statsVazias();
function aplicarStats(dados) {
  const base = statsVazias();
  stats.I = Object.assign(base.I, dados?.I || {});
  stats.D = Object.assign(base.D, dados?.D || {});
  stats.M = Object.assign(base.M, dados?.M || {});
}
const chaveStats = () => (NUVEM.logado ? "stats-conta" : "stats");
aplicarStats(guarda.ler(chaveStats(), {}));

function salvarStats() {
  guarda.gravar(chaveStats(), stats);
  if (NUVEM.logado) NUVEM.enviarStats(stats).catch(() => { /* fica pendente; vai na próxima abertura */ });
}

// Ao entrar na conta: se a nuvem já tem estatísticas, elas valem; se não, as deste aparelho viram as da conta.
async function sincronizarStats() {
  if (!NUVEM.logado) return;
  if (NUVEM.pendente) { // jogou sem internet: o aparelho está mais novo que a nuvem
    await NUVEM.enviarStats(stats).catch(() => {});
    return;
  }
  const remotas = await NUVEM.baixarStats();
  if (remotas) aplicarStats(remotas);
  else { aplicarStats(guarda.ler("stats", {})); await NUVEM.enviarStats(stats); }
  guarda.gravar("stats-conta", stats);
}

let J = null; // partida atual

/* ---------- regras ---------- */
function avaliar(tentativa, segredo) {
  const r = Array(segredo.length).fill("a");
  const sobra = {};
  for (let i = 0; i < segredo.length; i++) {
    if (tentativa[i] === segredo[i]) r[i] = "c";
    else sobra[segredo[i]] = (sobra[segredo[i]] || 0) + 1;
  }
  for (let i = 0; i < segredo.length; i++) {
    if (r[i] === "c") continue;
    if (sobra[tentativa[i]]) { r[i] = "p"; sobra[tentativa[i]]--; }
  }
  return r;
}

function novoJogador() { return { tentativas: [], avaliacoes: [], teclas: {}, acertou: false }; }

function novaPartida(modo = J?.modo || "I") {
  const lista = [...BANCO[cfg.tamanho].keys()];
  const segredo = lista[Math.floor(Math.random() * lista.length)];
  J = {
    modo, segredo, exibir: BANCO[cfg.tamanho].get(segredo),
    tamanho: cfg.tamanho, nivel: cfg.nivel, max: NIVEIS[cfg.nivel].tentativas,
    jogadores: modo === "D" ? [novoJogador(), novoJogador()] : [novoJogador()],
    vez: 0, atual: "", fim: false, resultado: null,
  };
  salvarPartida();
  desenhar();
  if (modo === "D") mostrarTransicao(0);
}

function salvarPartida() { guarda.gravar("partida", J); }

const jogadorDaVez = () => J.jogadores[J.vez];
const nomeDe = i => (i === 0 ? NUVEM.apelido || cfg.nome1 : cfg.nome2) || `Jogador ${i + 1}`;
const esgotou = j => j.tentativas.length >= J.max;

// Letras azuis já descobertas: aparecem prontas na linha seguinte, no mesmo lugar.
// J.atual guarda só o que o jogador digita nas casas livres; montar() junta as duas coisas.
function fixas(j = jogadorDaVez()) {
  const f = Array(J.tamanho).fill(null);
  j.avaliacoes.forEach((av, k) => av.forEach((e, i) => { if (e === "c") f[i] = j.tentativas[k][i]; }));
  return f;
}
const livres = (f = fixas()) => f.filter(x => !x).length;
function montar(f = fixas()) { let k = 0; return f.map(x => x || J.atual[k++] || ""); }

/* ---------- desenho ---------- */
const $ = s => document.querySelector(s);
const tabuleiro = $("#tabuleiro");
const teclado = $("#teclado");

function casaHTML(letra, est, i, vira) {
  const attrs = est ? ` data-e="${est}"` : "";
  const cls = "casa" + (letra && !est ? " cheia" : "") + (vira ? " vira" : "");
  return `<div class="${cls}"${attrs} style="--i:${i}">${letra || ""}</div>`;
}

function desenhar(animarUltima = false) {
  document.body.classList.toggle("simbolos", !!cfg.simbolos);
  const j = jogadorDaVez();
  const n = J.tamanho;

  $("#st-modo").textContent = MODOS[J.modo];
  $("#st-info").textContent = `${NIVEIS[J.nivel].nome} · ${n} letras`;
  const usadas = j.tentativas.length;
  $("#st-tent").textContent = `${Math.min(usadas + (J.fim || esgotou(j) ? 0 : 1), J.max)}/${J.max}`;
  const vez = $("#st-vez");
  vez.hidden = J.modo === "I";
  if (J.modo === "D") vez.textContent = J.fim ? "Partida encerrada" : `Vez de ${nomeDe(J.vez)}`;
  if (J.modo === "M") vez.textContent = `Sala ${J.online.codigo} · ${J.online.jogadores.length} jogadores`;
  desenharRivais();

  let html = "";
  j.tentativas.forEach((t, k) => {
    const av = j.avaliacoes[k];
    const anima = animarUltima && k === usadas - 1;
    html += `<div class="linha" style="--n:${n}" aria-label="Tentativa ${k + 1}: ${t}">` +
      [...t].map((l, i) => casaHTML(l, av[i], i, anima)).join("") + "</div>";
  });
  if (!J.fim && !esgotou(j)) {
    const f = fixas(j), m = montar(f);
    html += `<div class="linha" id="linha-atual" style="--n:${n}" aria-label="Tentativa atual">` +
      m.map((l, i) => f[i]
        ? `<div class="casa fixa" style="--i:${i}" aria-label="${l}, já descoberta">${l}</div>`
        : casaHTML(l, null, i)).join("") + "</div>";
  }
  tabuleiro.innerHTML = html;
  tabuleiro.scrollTop = tabuleiro.scrollHeight;

  desenharTeclado(j);
  document.querySelectorAll(".barra [data-nav]").forEach(b =>
    b.setAttribute("aria-current", String(b.dataset.nav === J.modo)));
}

const FILAS = ["QWERTYUIOP", "ASDFGHJKL", "-ZXCVBNM+"]; // apagar à esquerda, ENVIAR à direita
function desenharTeclado(j) {
  teclado.innerHTML = FILAS.map(f => `<div class="fila">${[...f].map(c => {
    if (c === "+") return `<button class="tecla larga enviar" data-k="Enter">ENVIAR</button>`;
    if (c === "-") return `<button class="tecla larga" data-k="Backspace" aria-label="Apagar"><svg class="ic"><use href="#i-del"/></svg></button>`;
    const e = j.teclas[c];
    return `<button class="tecla" data-k="${c}"${e ? ` data-e="${e}"` : ""}>${c}</button>`;
  }).join("")}</div>`).join("");
}

function linhaAtualAtualizar() {
  const linha = $("#linha-atual");
  if (!linha) return;
  const m = montar();
  $(".tecla.enviar")?.classList.toggle("pronto", J.atual.length >= livres());
  [...linha.children].forEach((c, i) => {
    if (c.classList.contains("fixa")) return;
    const l = m[i] || "";
    if (c.textContent !== l) {
      c.textContent = l;
      c.classList.toggle("cheia", !!l);
    }
  });
  $("#st-tent").textContent = `${jogadorDaVez().tentativas.length + 1}/${J.max}`;
}

let toastTimer;
function aviso(msg, ms = 1600) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("mostra");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("mostra"), ms);
}

/* ---------- entrada ---------- */
let travado = false;
function tecla(k) {
  if (!J || J.fim || travado || !$("#transicao").hidden || $("#dlg").open) return;
  const j = jogadorDaVez();
  if (esgotou(j)) return;
  if (J.modo === "M" && J.online.status !== "jogando") return aviso("Espere quem criou a sala tocar em Começar");
  if (k === "Enter") return J.modo === "M" ? enviarOnline() : enviar();
  if (k === "Backspace") { J.atual = J.atual.slice(0, -1); return linhaAtualAtualizar(); }
  const letra = sem_acento(k);
  if (/^[A-Z]$/.test(letra) && J.atual.length < livres()) {
    J.atual += letra;
    linhaAtualAtualizar();
  }
}

function enviar() {
  const j = jogadorDaVez();
  if (J.atual.length < livres()) {
    const linha = $("#linha-atual");
    linha?.classList.remove("treme"); void linha?.offsetWidth; linha?.classList.add("treme");
    return aviso(`A palavra tem ${J.tamanho} letras`);
  }
  const t = montar().join("");
  const av = avaliar(t, J.segredo);
  j.tentativas.push(t);
  j.avaliacoes.push(av);
  J.atual = "";
  const ordem = { c: 3, p: 2, a: 1 };
  [...t].forEach((l, i) => { if ((ordem[av[i]] || 0) > (ordem[j.teclas[l]] || 0)) j.teclas[l] = av[i]; });
  j.acertou = t === J.segredo;

  desenhar(true);
  travado = true;
  teclado.classList.add("travado");
  const espera = matchMedia("(prefers-reduced-motion: reduce)").matches ? 50 : J.tamanho * 110 + 500;
  setTimeout(() => { travado = false; teclado.classList.remove("travado"); depoisDaJogada(); }, espera);
  salvarPartida();
}

function depoisDaJogada() {
  const j = jogadorDaVez();
  if (J.modo === "I") {
    if (j.acertou) return encerrar({ venceu: true });
    if (esgotou(j)) return encerrar({ venceu: false });
    return;
  }
  // Dupla
  if (j.acertou) return encerrar({ vencedor: J.vez });
  const outro = 1 - J.vez;
  const outroAinda = !esgotou(J.jogadores[outro]);
  if (!outroAinda && esgotou(j)) return encerrar({ empate: true });
  if (outroAinda) {
    // deixa a tentativa na tela uns segundos antes de esconder e passar a vez
    J.vez = outro;
    salvarPartida();
    travado = true; teclado.classList.add("travado");
    aviso(`Vez de ${nomeDe(outro)} em instantes…`, 2800);
    setTimeout(() => {
      travado = false; teclado.classList.remove("travado");
      if (J.modo === "D" && J.vez === outro && !J.fim) mostrarTransicao(outro);
    }, ESPERA_PASSAR_VEZ);
  } else {
    aviso(`${nomeDe(outro)} já usou todas as tentativas`);
  }
}

/* ---------- transição da Dupla ---------- */
const ESPERA_PASSAR_VEZ = 3000; // ms que a tentativa fica à vista antes da tela de passar a vez
function mostrarTransicao(i) {
  tabuleiro.innerHTML = "";
  $("#tr-nome").textContent = nomeDe(i);
  $("#transicao").hidden = false;
  $("#tr-ok").focus();
}
$("#tr-ok").addEventListener("click", () => {
  $("#transicao").hidden = true;
  desenhar();
});

/* ---------- fim de partida ---------- */
function palavraHTML() {
  return `<div class="fim-palavra" style="--n:${J.tamanho}">` +
    [...J.exibir].map((l, i) => casaHTML(l, "c", i)).join("") + "</div>";
}

function encerrar(r) {
  J.fim = true;
  J.resultado = r;
  const n = jogadorDaVez().tentativas.length;
  if (J.modo === "I") {
    const s = stats.I;
    s.jogos++;
    if (r.venceu) {
      s.vitorias++; s.seq++; s.melhor = Math.max(s.melhor, s.seq); s.dist[n] = (s.dist[n] || 0) + 1;
      r.pontos = calcularPontos(J.tamanho, J.nivel, s.seq);
      s.pontos += r.pontos.total;
      r.recorde = r.pontos.total > s.recorde;
      s.recorde = Math.max(s.recorde, r.pontos.total);
    } else s.seq = 0; // perder não tira pontos, só zera a sequência
  } else {
    const s = stats.D;
    s.partidas++;
    if (r.empate) s.empates++;
    else {
      // na Dupla só quem vence pontua, sem bônus de sequência
      const nome = nomeDe(r.vencedor);
      s.vitorias[nome] = (s.vitorias[nome] || 0) + 1;
      r.pontos = calcularPontos(J.tamanho, J.nivel, 1);
      s.pontos[nome] = (s.pontos[nome] || 0) + r.pontos.total;
    }
  }
  salvarStats();
  salvarPartida();
  desenhar();
  setTimeout(() => {
    mostrarFim();
    if (r.venceu || r.vencedor !== undefined) soltarConfetes(); // depois da janela, para ficar por cima
  }, 300);
}

function mostrarFim() {
  const r = J.resultado;
  let titulo, texto;
  if (J.modo === "M") {
    const n = J.jogadores[0].tentativas.length;
    titulo = r.venceu ? "Você venceu!" : r.vencedor ? `${r.vencedor} venceu!` : "Ninguém acertou";
    texto = r.venceu ? `Acertou na ${n}ª tentativa, antes de todo mundo.` : "A palavra era:";
  } else if (J.modo === "I") {
    const n = J.jogadores[0].tentativas.length;
    titulo = r.venceu ? "Acertou!" : "Não foi dessa vez";
    texto = r.venceu ? `Em ${n} de ${J.max} tentativas.` : "A palavra era:";
  } else if (r.empate) {
    titulo = "Empate!"; texto = "Ninguém acertou. A palavra era:";
  } else {
    titulo = `${nomeDe(r.vencedor)} venceu!`;
    texto = `Acertou na ${J.jogadores[r.vencedor].tentativas.length}ª tentativa.`;
  }
  const p = r.pontos;
  const blocoPontos = p ? `
    <p class="pontos" aria-live="polite">+<span id="fim-pontos" data-alvo="${p.total}">${numBR(p.total)}</span> pontos</p>
    <p class="conta-pontos">${J.tamanho} letras (${p.base}) × ${NIVEIS[J.nivel].nome} (×${numBR(p.mult)})${
      p.bonus ? ` × sequência de ${stats.I.seq} (+${Math.round(p.bonus * 100)}%)` : ""}</p>
    ${r.recorde ? `<p class="recorde">Novo recorde!</p>` : ""}` : "";
  abrirDialogo(titulo, `
    <p class="centro">${texto}</p>${palavraHTML()}${blocoPontos}
    <div class="acoes">
      <button class="btn sec" data-acao="stats">Estatísticas</button>
      <button class="btn" data-acao="nova">Jogar de novo</button>
    </div>`);
  contarPontos();
}

// os pontos sobem de 0 até o total, junto com os confetes
function contarPontos() {
  const el = $("#fim-pontos");
  if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const alvo = Number(el.dataset.alvo), inicio = performance.now(), DURA = 1100;
  (function passo(t) {
    const f = Math.min(1, (t - inicio) / DURA);
    el.textContent = numBR(Math.round(alvo * (1 - Math.pow(1 - f, 3))));
    if (f < 1 && el.isConnected) requestAnimationFrame(passo);
  })(inicio);
}

/* ---------- confetes (desenho do Thomas: todas as cores, saindo de baixo e abrindo em leque) ---------- */
const CORES_CONFETE = ["#E53935", "#FB8C00", "#FDD835", "#43A047", "#1E88E5", "#3949AB", "#8E24AA", "#EC407A"];
function soltarConfetes() {
  // quem pediu menos animação no aparelho recebe uma chuva menor e mais curta
  const calmo = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const cv = $("#confete");
  try { if (cv.matches(":popover-open")) cv.hidePopover(); cv.showPopover(); } catch { /* navegador sem popover */ }
  const ctx = cv.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const W = innerWidth, H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const pecas = [];
  const rajada = (qtd) => {
    for (let i = 0; i < qtd; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.2; // leque para cima
      const vel = Math.sqrt(H) * (0.68 + Math.random() * 0.3); // pico entre ~45% e ~95% da altura
      pecas.push({
        x: W / 2 + (Math.random() - 0.5) * 30, y: H + 10,
        vx: Math.cos(ang) * vel, vy: Math.sin(ang) * vel,
        w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
        cor: CORES_CONFETE[i % CORES_CONFETE.length], fase: Math.random() * 6,
      });
    }
  };
  rajada(calmo ? 60 : 140);
  if (!calmo) setTimeout(() => rajada(90), 350);
  const DURA = calmo ? 2200 : 4500;
  const inicio = performance.now();
  const PASSO = 1000 / 60; // a física anda em passos de 60 Hz, qualquer que seja a tela (60, 90, 120 Hz)
  let simulado = 0;
  (function quadro(t) {
    const idade = t - inicio;
    let passos = 0;
    while (simulado + PASSO <= idade && passos < 240) {
      simulado += PASSO; passos++;
      for (const p of pecas) {
        p.vy += 0.32; p.vx *= 0.985; p.vy *= 0.99;
        if (p.vy > 2.2) p.vy = 2.2; // depois do pico, desce flutuando
        p.x += p.vx + Math.sin((simulado / 300) + p.fase) * 0.6; p.y += p.vy; p.rot += p.vr;
      }
    }
    ctx.clearRect(0, 0, W, H);
    for (const p of pecas) {
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.scale(1, Math.abs(Math.cos(p.rot * 2)) * 0.8 + 0.2); // efeito de girar no ar
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, idade - (DURA - 800)) / 800);
      ctx.fillStyle = p.cor;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (idade < DURA) requestAnimationFrame(quadro);
    else { ctx.clearRect(0, 0, W, H); try { cv.hidePopover(); } catch { /* idem */ } }
  })(inicio);
}

/* ---------- diálogos ---------- */
const dlg = $("#dlg");
function abrirDialogo(titulo, corpo) {
  delete dlg.dataset.tela;
  $("#dlg-titulo").textContent = titulo;
  $("#dlg-corpo").innerHTML = corpo;
  if (!dlg.open) dlg.showModal();
}
// a tela do código de recuperação só fecha pelo "Continuar" (depois de marcar "Já anotei")
dlg.addEventListener("cancel", e => { if (dlg.dataset.travado) e.preventDefault(); });
dlg.addEventListener("click", e => {
  if (dlg.dataset.travado && (e.target === dlg || e.target.closest("[data-fechar]"))) {
    return aviso("Marque “Já anotei” e toque em Continuar");
  }
  if (e.target === dlg || e.target.closest("[data-fechar]")) return dlg.close();
  const acao = e.target.closest("[data-acao]")?.dataset.acao;
  if (acao === "nova") { dlg.close(); if (J?.modo === "M") abrirOnline(); else novaPartida(); }
  if (acao === "stats") abrirStats();
  if (acao === "trocar") { dlg.close(); sairDaSala(); novaPartida(dlg.dataset.modo); }
});

function emAndamento() {
  return J && !J.fim && J.jogadores.some(j => j.tentativas.length > 0);
}

function trocarModo(modo) {
  if (J?.modo === "M" && !J.fim) {
    dlg.dataset.modo = modo;
    return abrirDialogo("Sair da sala online?", `
      <p>Você sai da sala ${esc(J.online.codigo)}${J.online.status === "jogando" ? " e deixa a partida pela metade" : ""}.</p>
      <div class="acoes">
        <button class="btn sec" data-fechar>Ficar</button>
        <button class="btn" data-acao="trocar">Sair e jogar ${MODOS[modo]}</button>
      </div>`);
  }
  if (!emAndamento()) return novaPartida(modo);
  dlg.dataset.modo = modo;
  abrirDialogo("Começar outra partida?", `
    <p>A partida atual será perdida.</p>
    <div class="acoes">
      <button class="btn sec" data-fechar>Continuar jogando</button>
      <button class="btn" data-acao="trocar">Começar ${MODOS[modo]}</button>
    </div>`);
}

function emBreve(titulo, texto) {
  abrirDialogo(titulo, `<p>${texto}</p><p class="centro">Em breve!</p>
    <div class="acoes"><button class="btn" data-fechar>Ok</button></div>`);
}

function abrirStats() {
  const s = stats.I;
  const pct = s.jogos ? Math.round(100 * s.vitorias / s.jogos) : 0;
  const maxDist = Math.max(1, ...Object.values(s.dist));
  const dist = Object.keys(s.dist).map(Number).sort((a, b) => a - b)
    .map(k => `<div><span>${k}</span><i style="width:${Math.round(100 * s.dist[k] / maxDist)}%">${s.dist[k]}</i></div>`).join("")
    || `<p class="centro">Ainda sem vitórias.</p>`;
  const d = stats.D;
  const placar = Object.entries(d.vitorias).sort((a, b) => (d.pontos[b[0]] || 0) - (d.pontos[a[0]] || 0) || b[1] - a[1])
    .map(([n, v]) => `<div class="troca"><span>${esc(n)}</span><span>${v} ${v === 1 ? "vitória" : "vitórias"} · ${numBR(d.pontos[n] || 0)} pts</span></div>`).join("");
  abrirDialogo("Estatísticas", `
    <div class="grupo">Individual</div>
    <div class="numeros numeros-2">
      <div><b>${numBR(s.pontos)}</b><span>pontos</span></div>
      <div><b>${numBR(s.recorde)}</b><span>recorde numa partida</span></div>
    </div>
    <div class="numeros">
      <div><b>${s.jogos}</b><span>jogos</span></div>
      <div><b>${pct}%</b><span>vitórias</span></div>
      <div><b>${s.seq}</b><span>sequência</span></div>
      <div><b>${s.melhor}</b><span>melhor seq.</span></div>
    </div>
    <div class="grupo">Acertou em quantas tentativas</div>
    <div class="dist">${dist}</div>
    <div class="grupo">Online</div>
    <p>${stats.M.partidas} partidas · ${stats.M.vitorias} vitórias · ${numBR(stats.M.pontos)} pontos</p>
    <div class="grupo">Dupla</div>
    <p>${d.partidas} partidas · ${d.empates} empates</p>${placar}`);
}

function abrirConfig() {
  const btn = (grupo, valor, rotulo, extra = "") =>
    `<button data-g="${grupo}" data-v="${valor}" aria-pressed="${String(cfg[grupo]) === String(valor)}">${rotulo}${extra}</button>`;
  abrirDialogo("Configurações", `
    <div class="grupo">Dificuldade</div>
    <div class="opcoes">${Object.entries(NIVEIS).map(([k, v]) => btn("nivel", k, v.nome, `<small>${v.tentativas} tentativas</small>`)).join("")}</div>
    <div class="grupo">Letras na palavra</div>
    <div class="opcoes">${TAMANHOS.map(t => btn("tamanho", t, t)).join("")}</div>
    <label class="troca">Símbolos nas cores (ajuda daltônicos)
      <input type="checkbox" id="cfg-simb" ${cfg.simbolos ? "checked" : ""}></label>
    <div class="grupo">Cores</div>
    <div class="legenda">
      <div>${casaHTML("A", "c", 0)} Letra no lugar certo</div>
      <div>${casaHTML("B", "p", 0)} Tem na palavra, em outro lugar</div>
      <div>${casaHTML("C", "a", 0)} Não tem na palavra</div>
    </div>
    <div class="grupo">Pontos por vitória</div>
    <p class="dica">${TAMANHOS.map(t => `${t} letras: ${BASE_PONTOS[t]}`).join(" · ")}<br>
      × nível: Fácil ×1 · Médio ×1,5 · Difícil ×2<br>
      + 10% por vitória seguida (até +50%). Perder não tira pontos.</p>
    <p class="centro" style="margin-top:14px">Dificuldade e letras valem a partir da próxima partida.</p>
    <div class="acoes"><button class="btn" data-acao="nova">Nova partida</button></div>`);
  $("#dlg-corpo").querySelectorAll("[data-g]").forEach(b => b.addEventListener("click", () => {
    const g = b.dataset.g;
    cfg[g] = g === "tamanho" ? Number(b.dataset.v) : b.dataset.v;
    b.parentElement.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    guarda.gravar("cfg", cfg);
  }));
  $("#cfg-simb").addEventListener("change", e => {
    cfg.simbolos = e.target.checked; guarda.gravar("cfg", cfg);
    document.body.classList.toggle("simbolos", cfg.simbolos);
  });
}

/* ---------- online: salas (2 a 4 jogadores, mesma palavra, quem acertar primeiro) ---------- */
function desenharRivais() {
  const box = $("#rivais");
  if (!J || J.modo !== "M") { box.hidden = true; box.innerHTML = ""; return; }
  const rivais = J.online.jogadores.filter(x => !x.eu);
  box.hidden = rivais.length === 0;
  box.innerHTML = rivais.map(r => {
    const ultimas = r.cores.slice(-3).map(c =>
      `<div class="mini-linha">${[...c].map(e => `<i data-e="${e}"></i>`).join("")}</div>`).join("");
    return `<div class="rival${r.acertou ? " acertou" : ""}">
      <div class="rival-cab"><span class="rival-nome">${esc(r.apelido)}</span><span class="rival-tent">${r.cores.length}/${J.max}</span></div>
      ${ultimas || `<div class="mini-vazio">ainda não jogou</div>`}</div>`;
  }).join("");
}

function abrirOnline() {
  if (J?.modo === "M" && !J.fim) {
    if (J.online.status === "esperando") return telaSala();
    return aviso("Você já está numa partida online");
  }
  if (!NUVEM.logado) {
    abrirDialogo("Jogar online", `
      <p>Jogue com amigos, cada um no seu celular: a mesma palavra para todos, e ganha quem acertar primeiro.</p>
      <p>Para isso, entre na sua conta (só apelido e senha).</p>
      <div class="acoes"><button class="btn" id="on-conta">Entrar ou criar conta</button></div>`);
    $("#on-conta").addEventListener("click", () => abrirConta());
    return;
  }
  abrirDialogo("Jogar online", `
    <p class="dica">De 2 a 4 jogadores, cada um no seu celular. Mesma palavra para todos: ganha quem acertar primeiro.</p>
    <div class="grupo">Criar uma sala</div>
    <p class="dica">${NIVEIS[cfg.nivel].nome} · ${cfg.tamanho} letras · ${NIVEIS[cfg.nivel].tentativas} tentativas (muda em Configurações)</p>
    <div class="acoes centro-acoes"><button class="btn" id="on-criar">Criar sala</button></div>
    <div class="grupo">Entrar numa sala</div>
    <label class="campo">Código da sala (5 letras)
      <input id="on-codigo" maxlength="5" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABCDE"></label>
    <p class="erro" id="c-erro" role="alert"></p>
    <div class="acoes"><button class="btn" id="on-entrar">Entrar na sala</button></div>`);
  const cod = $("#on-codigo");
  cod.addEventListener("input", () => { cod.value = cod.value.toUpperCase().replace(/[^A-Z]/g, ""); });
  formConta("#on-criar", async () => {
    const r = await ONLINE.criar(cfg.tamanho, cfg.nivel);
    iniciarOnline(r.codigo);
  });
  formConta("#on-entrar", async () => {
    if (cod.value.length !== 5) throw new Error("O código tem 5 letras");
    const r = await ONLINE.entrar(cod.value);
    iniciarOnline(r.codigo);
  });
}

function iniciarOnline(codigo) {
  J = {
    modo: "M", online: { codigo, status: "esperando", jogadores: [], souCriador: false },
    tamanho: cfg.tamanho, nivel: cfg.nivel, max: NIVEIS[cfg.nivel].tentativas,
    jogadores: [novoJogador()], vez: 0, atual: "", fim: false, resultado: null, exibir: "",
  };
  salvarPartida();
  desenhar();
  telaSala();
  ONLINE.escutar(codigo, aplicarEstado, erroOnline);
}

// Sala de espera: mostra o código para passar aos amigos e quem já entrou.
function telaSala() {
  const o = J.online;
  const lista = o.jogadores.length
    ? o.jogadores.map(j => `<li>${esc(j.apelido)}${j.criador ? " <small>(criou)</small>" : ""}${j.eu ? " <small>(você)</small>" : ""}</li>`).join("")
    : `<li class="dica">carregando…</li>`;
  const dono = o.jogadores.find(j => j.criador)?.apelido;
  abrirDialogo(`Sala ${o.codigo}`, `
    <p>Passe este código para os amigos:</p>
    <p class="codigo-grande">${esc(o.codigo)}</p>
    <div class="acoes centro-acoes"><button class="btn sec" id="sala-copiar">Copiar código</button></div>
    <p class="dica centro">${NIVEIS[J.nivel].nome} · ${J.tamanho} letras · até 4 jogadores</p>
    <div class="grupo">Na sala (${o.jogadores.length})</div>
    <ul class="lista-sala">${lista}</ul>
    <p class="erro" id="c-erro" role="alert"></p>
    <div class="acoes">
      <button class="btn sec" id="sala-sair">Sair da sala</button>
      ${o.souCriador
        ? `<button class="btn" id="sala-comecar" ${o.jogadores.length < 2 ? "disabled" : ""}>Começar</button>`
        : `<span class="dica">Esperando ${esc(dono || "quem criou")} começar…</span>`}
    </div>`);
  dlg.dataset.tela = "sala";
  $("#sala-copiar").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(o.codigo); aviso("Código copiado"); }
    catch { aviso("Não deu para copiar. Dite o código."); }
  });
  $("#sala-sair").addEventListener("click", () => { dlg.close(); sairDaSala(); novaPartida("I"); });
  if ($("#sala-comecar")) formConta("#sala-comecar", async () => { await ONLINE.comecar(o.codigo); });
}

function sairDaSala() {
  if (J?.modo !== "M") return;
  const cod = J.online.codigo;
  ONLINE.parar();
  if (!J.fim) ONLINE.sair(cod).catch(() => {});
}

// Estado novo vindo do servidor: atualiza sala, tabuleiro e adversários.
function aplicarEstado(e) {
  if (!J || J.modo !== "M" || J.online.codigo !== e.codigo) return;
  const antes = J.online.status;
  Object.assign(J.online, { status: e.status, jogadores: e.jogadores, souCriador: e.souCriador });
  J.tamanho = e.tamanho; J.nivel = e.nivel; J.max = e.max;
  const eu = J.jogadores[0];
  if (!travado && e.minhas.length !== eu.tentativas.length) { // reabriu o app: refaz o tabuleiro
    const novo = novoJogador();
    const ordem = { c: 3, p: 2, a: 1 };
    for (const m of e.minhas) {
      const av = [...m.cores];
      novo.tentativas.push(m.letras); novo.avaliacoes.push(av);
      [...m.letras].forEach((l, i) => { if ((ordem[av[i]] || 0) > (ordem[novo.teclas[l]] || 0)) novo.teclas[l] = av[i]; });
    }
    J.jogadores[0] = novo;
  }
  if (e.status === "esperando" && dlg.open && dlg.dataset.tela === "sala") telaSala();
  if (e.status === "jogando" && antes === "esperando") {
    if (dlg.open && dlg.dataset.tela === "sala") dlg.close();
    aviso("Valendo! Boa sorte", 2200);
  }
  salvarPartida();
  if (e.status === "fim" && !J.fim) return encerrarOnline(e);
  if (!travado) desenhar(); else desenharRivais();
}

function erroOnline(err) {
  if (err.status === 404 || err.status === 403) {
    ONLINE.parar();
    if (dlg.open && dlg.dataset.tela === "sala") dlg.close();
    aviso("A sala foi fechada", 2500);
    novaPartida("I");
  }
}

async function enviarOnline() {
  if (J.atual.length < livres()) {
    const linha = $("#linha-atual");
    linha?.classList.remove("treme"); void linha?.offsetWidth; linha?.classList.add("treme");
    return aviso(`A palavra tem ${J.tamanho} letras`);
  }
  const t = montar().join("");
  travado = true; teclado.classList.add("travado");
  let r;
  try { r = await ONLINE.jogar(J.online.codigo, t); }
  catch (e) { travado = false; teclado.classList.remove("travado"); return aviso(e.message, 2200); }
  if (!r.cores) { // a partida acabou enquanto a tentativa ia
    travado = false; teclado.classList.remove("travado");
    return aplicarEstado(await ONLINE.estado(J.online.codigo));
  }
  const j = J.jogadores[0], av = [...r.cores], ordem = { c: 3, p: 2, a: 1 };
  j.tentativas.push(t); j.avaliacoes.push(av); J.atual = "";
  [...t].forEach((l, i) => { if ((ordem[av[i]] || 0) > (ordem[j.teclas[l]] || 0)) j.teclas[l] = av[i]; });
  desenhar(true);
  salvarPartida();
  const espera = matchMedia("(prefers-reduced-motion: reduce)").matches ? 50 : J.tamanho * 110 + 500;
  setTimeout(async () => {
    travado = false; teclado.classList.remove("travado");
    try { aplicarEstado(await ONLINE.estado(J.online.codigo)); } catch { desenhar(); }
  }, espera);
}

function encerrarOnline(e) {
  ONLINE.parar();
  J.fim = true;
  J.exibir = e.palavra || "";
  const venceu = !!e.jogadores.find(x => x.eu)?.venceu;
  const r = { venceu, vencedor: e.vencedor };
  stats.M.partidas++;
  if (venceu) {
    r.pontos = calcularPontos(J.tamanho, J.nivel, 1);
    stats.M.vitorias++;
    stats.M.pontos += r.pontos.total;
  }
  J.resultado = r;
  salvarStats();
  salvarPartida();
  desenhar();
  setTimeout(() => { mostrarFim(); if (venceu) soltarConfetes(); }, 300);
}

/* ---------- conta (apelido + senha, sem e-mail) ---------- */
function atualizarBotaoConta() {
  const b = $("#btn-conta");
  if (NUVEM.logado) {
    b.innerHTML = `<span class="inicial">${esc(NUVEM.apelido[0].toUpperCase())}</span>`;
    b.setAttribute("aria-label", `Minha conta: ${NUVEM.apelido}`);
  } else {
    b.innerHTML = `<svg class="ic"><use href="#i-user"/></svg>`;
    b.setAttribute("aria-label", "Minha conta");
  }
}

// Liga um formulário de conta: mostra "Aguarde…", trava o botão e escreve o erro perto dele.
function formConta(idBotao, acao) {
  const btn = $(idBotao), msg = $("#c-erro");
  const rodar = async () => {
    msg.textContent = "";
    const rotulo = btn.textContent;
    btn.disabled = true; btn.textContent = "Aguarde…";
    try { await acao(); }
    catch (e) { msg.textContent = e.message; btn.disabled = false; btn.textContent = rotulo; }
  };
  btn.addEventListener("click", rodar);
  $("#dlg-corpo").querySelectorAll("input").forEach(i =>
    i.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); rodar(); } }));
}

const DICA_APELIDO = "Sem espaços: use letras, números ou _ (ex.: Thomas_10)";
const campoApelido = (v = "") => `<label class="campo">Apelido
  <input id="c-ap" maxlength="24" autocomplete="username" autocapitalize="off" spellcheck="false"
    aria-describedby="c-ap-dica" value="${esc(v)}"></label>
  <p class="dica-campo" id="c-ap-dica">${DICA_APELIDO}</p>`;
const campoSenha = (id, rotulo, novo) => `<label class="campo" for="${id}">${rotulo}</label>
  <div class="senha-caixa">
    <input id="${id}" type="password" maxlength="72" autocomplete="${novo ? "new-password" : "current-password"}">
    <button type="button" class="ver-senha" data-ver="${id}" aria-label="Mostrar senha" aria-pressed="false">
      <svg class="ic"><use href="#i-olho"/></svg></button>
  </div>`;

// Valida o apelido antes de mandar: o espaço ganha uma mensagem própria.
function conferirApelido(ap) {
  if (/\s/.test(ap)) throw new Error("O apelido não pode ter espaço. Use _ no lugar (ex.: Thomas_10)");
  if (!/^[A-Za-z0-9_]{3,24}$/.test(ap)) throw new Error("O apelido precisa ter de 3 a 24 caracteres: letras, números ou _");
}

// Liga os detalhes dos campos de conta: aviso ao digitar espaço e o olho que mostra/esconde a senha.
function ligarCamposConta() {
  const ap = $("#c-ap"), dica = $("#c-ap-dica");
  ap?.addEventListener("input", () => {
    const temEspaco = /\s/.test(ap.value);
    dica.textContent = temEspaco ? "O apelido não pode ter espaço. Use _ no lugar." : DICA_APELIDO;
    dica.classList.toggle("alerta", temEspaco);
  });
  $("#dlg-corpo").querySelectorAll("[data-ver]").forEach(b => b.addEventListener("click", () => {
    const campo = $("#" + b.dataset.ver);
    const mostrar = campo.type === "password";
    campo.type = mostrar ? "text" : "password";
    b.setAttribute("aria-pressed", String(mostrar));
    b.setAttribute("aria-label", mostrar ? "Esconder senha" : "Mostrar senha");
    b.innerHTML = `<svg class="ic"><use href="#${mostrar ? "i-olho-off" : "i-olho"}"/></svg>`;
    campo.focus();
  }));
}

function abrirConta(aba = "entrar") {
  if (NUVEM.logado) return telaContaLogado();
  const criar = aba === "criar";
  abrirDialogo("Minha conta", `
    <div class="abas" role="tablist">
      <button role="tab" aria-selected="${!criar}" data-aba="entrar">Entrar</button>
      <button role="tab" aria-selected="${criar}" data-aba="criar">Criar conta</button>
    </div>
    ${campoApelido()}
    ${campoSenha("c-senha", "Senha", criar)}
    ${criar ? `<p class="dica-campo">Mínimo de 6 caracteres. Pode ser só letras ou só números.</p>` : ""}
    ${criar ? campoSenha("c-senha2", "Repita a senha", true) +
      `<p class="dica">Use um apelido, não o seu nome completo. Só pedimos apelido e senha.</p>` : ""}
    <p class="erro" id="c-erro" role="alert"></p>
    <div class="acoes">
      ${criar ? "" : `<button class="btn link" id="c-esqueci">Esqueci a senha</button>`}
      <button class="btn" id="c-ok">${criar ? "Criar conta" : "Entrar"}</button>
    </div>`);
  $("#dlg-corpo").querySelectorAll("[data-aba]").forEach(b =>
    b.addEventListener("click", () => abrirConta(b.dataset.aba)));
  $("#c-esqueci")?.addEventListener("click", telaRecuperar);
  ligarCamposConta();
  $("#c-ap").focus();
  formConta("#c-ok", async () => {
    const ap = $("#c-ap").value.trim(), senha = $("#c-senha").value;
    conferirApelido(ap);
    if (senha.length < 6) throw new Error("A senha precisa ter pelo menos 6 caracteres");
    if (criar) {
      if (senha !== $("#c-senha2").value) throw new Error("As duas senhas estão diferentes");
      const codigo = await NUVEM.cadastrar(ap, senha);
      await depoisDeEntrar();
      telaCodigo(codigo, "Conta criada!");
    } else {
      await NUVEM.entrar(ap, senha);
      await depoisDeEntrar();
      dlg.close();
      aviso(`Oi, ${NUVEM.apelido}!`);
    }
  });
}

async function depoisDeEntrar() {
  atualizarBotaoConta();
  await sincronizarStats().catch(() => {});
  if (J && !J.fim) desenhar();
}

function telaRecuperar() {
  abrirDialogo("Recuperar a conta", `
    <p>Use o código de recuperação que apareceu quando você criou a conta.</p>
    ${campoApelido()}
    <label class="campo">Código de recuperação
      <input id="c-cod" maxlength="9" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABCD-EFGH"></label>
    ${campoSenha("c-senha", "Senha nova", true)}
    <p class="erro" id="c-erro" role="alert"></p>
    <div class="acoes">
      <button class="btn sec" id="c-voltar">Voltar</button>
      <button class="btn" id="c-ok">Trocar senha</button>
    </div>`);
  $("#c-voltar").addEventListener("click", () => abrirConta("entrar"));
  ligarCamposConta();
  $("#c-ap").focus();
  formConta("#c-ok", async () => {
    const ap = $("#c-ap").value.trim(), cod = $("#c-cod").value.trim(), senha = $("#c-senha").value;
    if (!ap || !cod) throw new Error("Preencha o apelido e o código");
    conferirApelido(ap);
    if (senha.length < 6) throw new Error("A senha precisa ter pelo menos 6 caracteres");
    const novo = await NUVEM.recuperar(ap, cod, senha);
    await depoisDeEntrar();
    telaCodigo(novo, "Senha trocada!", "O código antigo não vale mais. Anote este novo:");
  });
}

// Mostra o código de recuperação uma única vez; só deixa seguir depois de marcar "Já anotei".
function telaCodigo(codigo, titulo, texto = "Este é o seu código de recuperação. Ele é o único jeito de recuperar a conta se você esquecer a senha.") {
  abrirDialogo(titulo, `
    <p>${texto}</p>
    <p class="codigo-grande" id="c-codigo">${esc(codigo)}</p>
    <p class="dica centro">Anote num papel ou tire um print desta tela.</p>
    <div class="acoes centro-acoes"><button class="btn sec" id="c-copiar">Copiar código</button></div>
    <label class="troca"><span>Já anotei o meu código</span><input type="checkbox" id="c-anotei"></label>
    <div class="acoes"><button class="btn" id="c-continuar" disabled>Continuar</button></div>`);
  dlg.dataset.travado = "1"; // não fecha clicando fora antes de anotar
  $("#c-copiar").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(codigo); aviso("Código copiado"); }
    catch { aviso("Não deu para copiar. Anote o código."); }
  });
  $("#c-anotei").addEventListener("change", e => { $("#c-continuar").disabled = !e.target.checked; });
  $("#c-continuar").addEventListener("click", () => { delete dlg.dataset.travado; dlg.close(); });
}

function telaContaLogado() {
  const status = NUVEM.pendente
    ? "Estatísticas esperando internet para subir."
    : "Suas estatísticas ficam salvas na conta.";
  abrirDialogo("Minha conta", `
    <p class="ola">Você entrou como <b>${esc(NUVEM.apelido)}</b></p>
    <p class="dica">${status}</p>
    <label class="campo">Nome do 2º jogador (Dupla)<input id="c-n2" maxlength="24" value="${esc(cfg.nome2)}"></label>
    <p class="erro" id="c-erro" role="alert"></p>
    <div class="acoes">
      <button class="btn sec" id="c-codigo-novo">Novo código de recuperação</button>
      <button class="btn sec" id="c-sair">Sair</button>
    </div>
    <div class="acoes"><button class="btn link perigo" id="c-apagar">Apagar minha conta</button></div>`);
  $("#c-n2").addEventListener("change", e => {
    cfg.nome2 = e.target.value.trim() || "Jogador 2"; guarda.gravar("cfg", cfg);
  });
  formConta("#c-codigo-novo", async () => telaCodigo(await NUVEM.novoCodigo(), "Novo código", "O código anterior não vale mais. Anote este:"));
  $("#c-sair").addEventListener("click", () => {
    NUVEM.sair();
    aplicarStats(guarda.ler("stats", {}));
    atualizarBotaoConta();
    dlg.close();
    if (J && !J.fim) desenhar();
    aviso("Você saiu da conta");
  });
  $("#c-apagar").addEventListener("click", telaApagar);
}

function telaApagar() {
  abrirDialogo("Apagar a conta?", `
    <p>A conta <b>${esc(NUVEM.apelido)}</b> e todas as estatísticas dela serão apagadas para sempre. Não dá para desfazer.</p>
    <label class="campo">Para confirmar, digite o seu apelido<input id="c-conf" maxlength="24" autocomplete="off" autocapitalize="off"></label>
    <p class="erro" id="c-erro" role="alert"></p>
    <div class="acoes">
      <button class="btn sec" id="c-voltar">Voltar</button>
      <button class="btn perigo-cheio" id="c-ok">Apagar para sempre</button>
    </div>`);
  $("#c-voltar").addEventListener("click", telaContaLogado);
  formConta("#c-ok", async () => {
    if ($("#c-conf").value.trim().toLowerCase() !== NUVEM.apelido.toLowerCase()) throw new Error("O apelido digitado não confere");
    await NUVEM.apagarConta();
    aplicarStats(guarda.ler("stats", {}));
    atualizarBotaoConta();
    dlg.close();
    aviso("Conta apagada");
  });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- eventos ---------- */
teclado.addEventListener("click", e => {
  const b = e.target.closest("[data-k]");
  if (b) tecla(b.dataset.k);
});
document.addEventListener("keydown", e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest("input, dialog")) return;
  if (e.key === "Enter" || e.key === "Backspace" || /^[a-zA-ZçÇ]$/.test(e.key)) {
    e.preventDefault();
    tecla(e.key.length === 1 ? e.key.toUpperCase() : e.key);
  }
});
document.querySelector(".barra").addEventListener("click", e => {
  const nav = e.target.closest("[data-nav]")?.dataset.nav;
  if (!nav) return;
  if (nav === "I" || nav === "D") return trocarModo(nav);
  if (nav === "M") return abrirOnline();
  if (nav === "mundial") return abrirMundial();
  if (nav === "stats") return abrirStats();
  if (nav === "config") return abrirConfig();
});
$("#btn-conta").addEventListener("click", () => abrirConta());
$("#btn-ajuda").addEventListener("click", abrirAjuda);

/* ---------- ranking Mundial ---------- */
async function abrirMundial() {
  abrirDialogo("Ranking Mundial", `<p class="dica centro">Carregando…</p>`);
  dlg.dataset.tela = "mundial";
  let linhas;
  try {
    // antes de ver o ranking, garante que os pontos deste aparelho já subiram
    if (NUVEM.logado) await NUVEM.enviarStats(stats).catch(() => {});
    linhas = await NUVEM.ranking(50);
  } catch (e) {
    if (dlg.dataset.tela === "mundial") $("#dlg-corpo").innerHTML = `<p class="erro">${esc(e.message)}</p>`;
    return;
  }
  if (dlg.dataset.tela !== "mundial") return; // fechou ou abriu outra tela enquanto carregava
  const medalha = p => (p <= 3 ? ` medalha m${p}` : "");
  const lista = linhas.length ? linhas.map((l, i) => {
    const pulo = i > 0 && l.posicao > linhas[i - 1].posicao + 1 && l.eu ? `<li class="pulo">⋯</li>` : "";
    return `${pulo}<li class="${l.eu ? "eu" : ""}">
      <span class="pos${medalha(l.posicao)}">${l.posicao}</span>
      <span class="nome">${esc(l.apelido)}${l.eu ? " <small>(você)</small>" : ""}</span>
      <span class="pts">${numBR(l.pontos)}</span></li>`;
  }).join("") : `<li class="dica">Ninguém pontuou ainda. Seja o primeiro!</li>`;
  const rodape = NUVEM.logado
    ? (linhas.some(l => l.eu) ? "" : `<p class="dica centro">Ganhe uma partida para aparecer aqui.</p>`)
    : `<p class="dica centro">Crie uma conta para aparecer no ranking.</p>
       <div class="acoes centro-acoes"><button class="btn" id="mun-conta">Entrar ou criar conta</button></div>`;
  $("#dlg-corpo").innerHTML = `
    <p class="dica">Soma dos pontos do Individual e do Online de cada jogador.</p>
    <ol class="ranking">${lista}</ol>${rodape}`;
  $("#mun-conta")?.addEventListener("click", () => abrirConta());
}

/* ---------- ajuda: como jogar ---------- */
function abrirAjuda() {
  abrirDialogo("Como jogar", `<div class="ajuda">
    <p>Descubra a <b>palavra secreta</b>. Digite uma palavra com o mesmo número de letras e toque em <b>ENVIAR</b>.</p>
    <h3>O que as cores dizem</h3>
    <div class="legenda">
      <div>${casaHTML("A", "c", 0)} Azul: a letra está na palavra e no lugar certo</div>
      <div>${casaHTML("B", "p", 0)} Laranja: a letra está na palavra, mas em outro lugar</div>
      <div>${casaHTML("C", "a", 0)} Vermelho: a letra não está na palavra</div>
    </div>
    <p>As letras azuis já aparecem prontas na linha seguinte, no mesmo lugar: você só digita as que faltam.</p>
    <p>O teclado também fica colorido, para lembrar das letras já usadas. Acentos não contam: CAFÉ = CAFE.</p>
    <h3>Modos de jogo</h3>
    <ul>
      <li><b>I · Individual:</b> você contra a palavra.</li>
      <li><b>D · Dupla:</b> dois jogadores no mesmo celular, a mesma palavra, um de cada vez. Uma tela azul esconde as tentativas do outro.</li>
      <li><b>M · Online:</b> de 2 a 4 amigos, cada um no seu celular. Um cria a sala e passa o código de 5 letras; todos jogam ao mesmo tempo e ganha quem acertar primeiro. Dos adversários você vê só as cores. Precisa de conta.</li>
    </ul>
    <h3>Dificuldade e tamanho</h3>
    <p>Em <b>Config</b>: Fácil (20 tentativas), Médio (15) ou Difícil (10), e palavras de 4 a 7 letras.</p>
    <h3>Pontos</h3>
    <p>Cada vitória vale: ${TAMANHOS.map(t => `${t} letras = ${BASE_PONTOS[t]}`).join(", ")}, vezes o nível (Fácil ×1, Médio ×1,5, Difícil ×2). Vitórias seguidas dão +10% cada, até +50%. Perder não tira pontos.</p>
    <h3>Ranking Mundial</h3>
    <p>O globo mostra os jogadores com mais pontos (Individual + Online). Para aparecer, é preciso ter conta.</p>
    <h3>Conta</h3>
    <p>Só apelido (sem espaço) e senha de pelo menos 6 caracteres. Guarde o <b>código de recuperação</b>: é o único jeito de voltar se esquecer a senha. Com conta, suas estatísticas ficam salvas em qualquer celular.</p>
    <div class="acoes"><button class="btn" data-fechar>Entendi</button></div>
  </div>`);
}

/* ---------- início ---------- */
(function iniciar() {
  atualizarBotaoConta();
  sincronizarStats().catch(() => { /* sem internet: segue com o que está no aparelho */ });
  const salva = guarda.ler("partida", null);
  if (salva?.modo === "M" && !salva.fim && NUVEM.logado) {
    J = salva;
    desenhar();
    ONLINE.escutar(J.online.codigo, aplicarEstado, erroOnline);
  } else if (salva && salva.segredo && BANCO[salva.tamanho]?.has(salva.segredo) && !salva.fim) {
    J = salva;
    desenhar();
    if (J.modo === "D") mostrarTransicao(J.vez);
  } else {
    novaPartida("I");
  }
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();

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
const MODOS = { I: "Individual", D: "Dupla" };

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
});
const stats = statsVazias();
function aplicarStats(dados) {
  const base = statsVazias();
  stats.I = Object.assign(base.I, dados?.I || {});
  stats.D = Object.assign(base.D, dados?.D || {});
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
  vez.hidden = J.modo !== "D";
  if (J.modo === "D") vez.textContent = J.fim ? "Partida encerrada" : `Vez de ${nomeDe(J.vez)}`;

  let html = "";
  j.tentativas.forEach((t, k) => {
    const av = j.avaliacoes[k];
    const anima = animarUltima && k === usadas - 1;
    html += `<div class="linha" style="--n:${n}" aria-label="Tentativa ${k + 1}: ${t}">` +
      [...t].map((l, i) => casaHTML(l, av[i], i, anima)).join("") + "</div>";
  });
  if (!J.fim && !esgotou(j)) {
    html += `<div class="linha" id="linha-atual" style="--n:${n}" aria-label="Tentativa atual">` +
      Array.from({ length: n }, (_, i) => casaHTML(J.atual[i], null, i)).join("") + "</div>";
  }
  tabuleiro.innerHTML = html;
  tabuleiro.scrollTop = tabuleiro.scrollHeight;

  desenharTeclado(j);
  document.querySelectorAll(".barra [data-nav]").forEach(b =>
    b.setAttribute("aria-current", String(b.dataset.nav === J.modo)));
}

const FILAS = ["QWERTYUIOP", "ASDFGHJKL", "+ZXCVBNM-"];
function desenharTeclado(j) {
  teclado.innerHTML = FILAS.map(f => `<div class="fila">${[...f].map(c => {
    if (c === "+") return `<button class="tecla larga" data-k="Enter">ENVIAR</button>`;
    if (c === "-") return `<button class="tecla larga" data-k="Backspace" aria-label="Apagar"><svg class="ic"><use href="#i-del"/></svg></button>`;
    const e = j.teclas[c];
    return `<button class="tecla" data-k="${c}"${e ? ` data-e="${e}"` : ""}>${c}</button>`;
  }).join("")}</div>`).join("");
}

function linhaAtualAtualizar() {
  const linha = $("#linha-atual");
  if (!linha) return;
  [...linha.children].forEach((c, i) => {
    const l = J.atual[i] || "";
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
  if (k === "Enter") return enviar();
  if (k === "Backspace") { J.atual = J.atual.slice(0, -1); return linhaAtualAtualizar(); }
  const letra = sem_acento(k);
  if (/^[A-Z]$/.test(letra) && J.atual.length < J.tamanho) {
    J.atual += letra;
    linhaAtualAtualizar();
  }
}

function enviar() {
  const j = jogadorDaVez();
  if (J.atual.length < J.tamanho) {
    const linha = $("#linha-atual");
    linha?.classList.remove("treme"); void linha?.offsetWidth; linha?.classList.add("treme");
    return aviso(`A palavra tem ${J.tamanho} letras`);
  }
  const t = J.atual;
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
    J.vez = outro;
    salvarPartida();
    mostrarTransicao(outro);
  } else {
    aviso(`${nomeDe(outro)} já usou todas as tentativas`);
  }
}

/* ---------- transição da Dupla ---------- */
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
  if (J.modo === "I") {
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
  if (acao === "nova") { dlg.close(); novaPartida(); }
  if (acao === "stats") abrirStats();
  if (acao === "trocar") { dlg.close(); novaPartida(dlg.dataset.modo); }
});

function emAndamento() {
  return J && !J.fim && J.jogadores.some(j => j.tentativas.length > 0);
}

function trocarModo(modo) {
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

const campoApelido = (v = "") => `<label class="campo">Apelido
  <input id="c-ap" maxlength="16" autocomplete="username" autocapitalize="off" spellcheck="false" value="${esc(v)}"></label>`;
const campoSenha = (id, rotulo, novo) => `<label class="campo">${rotulo}
  <input id="${id}" type="password" maxlength="72" autocomplete="${novo ? "new-password" : "current-password"}"></label>`;

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
  $("#c-ap").focus();
  formConta("#c-ok", async () => {
    const ap = $("#c-ap").value.trim(), senha = $("#c-senha").value;
    if (!/^[A-Za-z0-9_]{3,16}$/.test(ap)) throw new Error("O apelido precisa ter de 3 a 16 caracteres: letras, números ou _");
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
  $("#c-ap").focus();
  formConta("#c-ok", async () => {
    const ap = $("#c-ap").value.trim(), cod = $("#c-cod").value.trim(), senha = $("#c-senha").value;
    if (!ap || !cod) throw new Error("Preencha o apelido e o código");
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
    <label class="campo">Nome do 2º jogador (Dupla)<input id="c-n2" maxlength="16" value="${esc(cfg.nome2)}"></label>
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
    <label class="campo">Para confirmar, digite o seu apelido<input id="c-conf" maxlength="16" autocomplete="off" autocapitalize="off"></label>
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
  if (nav === "M") return emBreve("Multiplayer", "Jogar online contra amigos, cada um no seu aparelho.");
  if (nav === "mundial") return emBreve("Mundial", "Ranking com jogadores do mundo todo.");
  if (nav === "stats") return abrirStats();
  if (nav === "config") return abrirConfig();
});
$("#btn-conta").addEventListener("click", () => abrirConta());

/* ---------- início ---------- */
(function iniciar() {
  atualizarBotaoConta();
  sincronizarStats().catch(() => { /* sem internet: segue com o que está no aparelho */ });
  const salva = guarda.ler("partida", null);
  if (salva && salva.segredo && BANCO[salva.tamanho]?.has(salva.segredo) && !salva.fim) {
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

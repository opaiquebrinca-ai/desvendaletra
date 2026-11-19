// Guarda os arquivos do jogo para funcionar sem internet.
// Ao mudar qualquer arquivo, troque a versão abaixo para o aparelho baixar de novo.
const VERSAO = "jogo-thomas-v8";
const ARQUIVOS = ["./", "index.html", "estilo.css", "jogo.js", "palavras.js", "nuvem.js", "online.js", "manifest.webmanifest",
  "icone.svg", "icone-192.png", "icone-512.png", "icone-180.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(chaves => Promise.all(chaves.filter(k => k !== VERSAO).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // fontes do Google: deixa o navegador cuidar
  // rede primeiro (pega versão nova), cache se estiver sem internet
  e.respondWith(
    fetch(e.request)
      .then(r => { const copia = r.clone(); caches.open(VERSAO).then(c => c.put(e.request, copia)); return r; })
      .catch(() => caches.match(e.request))
  );
});

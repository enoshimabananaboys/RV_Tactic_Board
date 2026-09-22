// 公開ファイルを変更したらバージョンを更新する。scopeごとにキャッシュを分離する。
const PREFIX = "rv-tactic-board-" + self.registration.scope + "-";
const CACHE = PREFIX + "v25";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./board-model.js",
  "./ball.svg",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];
// 全ファイルの保存が成功した場合だけ、新版のインストールを完了する。
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});
// 同じアプリの旧キャッシュだけを消す。他のアプリのデータには触れない。
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(PREFIX) && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
// キャッシュ優先。通信不能なページ遷移は保存済みの入口へ戻す。
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !url.href.startsWith(self.registration.scope)
  )
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        return await fetch(request);
      } catch (error) {
        if (request.mode === "navigate")
          return await cache.match("./index.html");
        throw error;
      }
    })(),
  );
});

// Makes the site installable as an app (PWA)

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

// Adds a "📲 Install app" button when the browser says the app can be installed
let installEvent = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvent = e;

  const bar = document.querySelector(".modes");
  if (!bar || document.getElementById("install-btn")) return;

  const btn = document.createElement("button");
  btn.id = "install-btn";
  btn.innerText = "📲 Install app";
  btn.onclick = async () => {
    installEvent.prompt();
    await installEvent.userChoice;
    installEvent = null;
    btn.remove();
  };
  bar.appendChild(btn);
});

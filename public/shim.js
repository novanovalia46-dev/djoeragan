/* ====== EDIT SATU BARIS INI ====== */
var GAS_URL = "https://script.google.com/macros/s/AKfycbzSObjLNww7Q46Ii4b0RMQ9tsPdKOueuyrGwntTy5Dcj3qf8ocwX7diHEERud1ycQI/exec";
/* ================================== */

(function () {
  var TOKEN_KEY = "djoeragan_token", USER_KEY = "djoeragan_user";
  var token = localStorage.getItem(TOKEN_KEY) || "";

  function api(fn, args) {
    return fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ fn: fn, args: args || [], token: token })
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (res && res.auth) { clearSession(); showLogin("Sesi habis. Login ulang."); }
      if (!res || !res.ok) throw new Error((res && res.error) || "Request gagal");
      return res.data;
    });
  }

  function makeRunner(ok, fail) {
    return new Proxy({}, {
      get: function (_, name) {
        if (name === "withSuccessHandler") return function (f) { return makeRunner(f, fail); };
        if (name === "withFailureHandler") return function (f) { return makeRunner(ok, f); };
        if (name === "withUserObject") return function () { return makeRunner(ok, fail); };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          api(String(name), args).then(
            function (d) { if (ok) ok(d); },
            function (e) { if (fail) fail(e); else console.error(name, e); }
          );
        };
      }
    });
  }
  window.google = { script: { run: makeRunner(null, null) } };

  function clearSession() {
    token = ""; localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY);
  }

  function applyUser(u) {
    try { if (window.currentUser && u) Object.assign(window.currentUser, u); } catch (e) {}
  }

  var box;
  function showLogin(msg) {
    if (!box) {
      box = document.createElement("div");
      box.style.cssText = "position:fixed;inset:0;z-index:99999;background:#1f3a5f;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif";
      box.innerHTML =
        '<form id="lg-f" style="background:#fff;padding:28px;border-radius:8px;width:100%;max-width:360px;box-shadow:0 4px 15px rgba(0,0,0,.3)">' +
        '<h4 style="margin:0 0 16px">Djoeragan Bumbu - Login</h4>' +
        '<input id="lg-u" placeholder="Username" autocomplete="username" style="width:100%;padding:10px;margin-bottom:10px;box-sizing:border-box">' +
        '<input id="lg-p" type="password" placeholder="Password" autocomplete="current-password" style="width:100%;padding:10px;margin-bottom:10px;box-sizing:border-box">' +
        '<div id="lg-e" style="color:#c00;font-size:13px;min-height:18px;margin-bottom:8px"></div>' +
        '<button id="lg-b" type="submit" style="width:100%;padding:10px;background:#0d6efd;color:#fff;border:0;border-radius:4px;cursor:pointer">Masuk</button>' +
        '</form>';
      document.body.appendChild(box);
      box.querySelector("#lg-f").addEventListener("submit", function (ev) {
        ev.preventDefault();
        var b = box.querySelector("#lg-b"), e = box.querySelector("#lg-e");
        b.disabled = true; b.textContent = "Memproses..."; e.textContent = "";
        fetch(GAS_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ fn: "__login", args: [box.querySelector("#lg-u").value, box.querySelector("#lg-p").value] })
        }).then(function (r) { return r.json(); }).then(function (res) {
          if (!res.ok) throw new Error(res.error || "Login gagal");
          token = res.data.token;
          localStorage.setItem(TOKEN_KEY, token);
          localStorage.setItem(USER_KEY, JSON.stringify(res.data.user));
          location.reload();
        }).catch(function (er) {
          e.textContent = er.message; b.disabled = false; b.textContent = "Masuk";
        });
      });
    }
    box.style.display = "flex";
    if (msg) box.querySelector("#lg-e").textContent = msg;
  }

  window.addEventListener("load", function () {
    if (!token) { showLogin(); return; }
    try { applyUser(JSON.parse(localStorage.getItem(USER_KEY) || "null")); } catch (e) {}
    var lo = document.createElement("button");
    lo.textContent = "Logout";
    lo.style.cssText = "position:fixed;right:10px;bottom:10px;z-index:9999;padding:6px 12px;opacity:.7;border:0;border-radius:4px;background:#333;color:#fff;cursor:pointer";
    lo.onclick = function () {
      api("__logout", []).catch(function () {}).then(function () { clearSession(); location.reload(); });
    };
    document.body.appendChild(lo);
  });
})();

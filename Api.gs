/**
 * =========================================================
 * API LAYER untuk frontend di Vercel
 * File BARU. Tambahkan ke project Apps Script, jangan ubah Kode.gs / Penawaran.gs.
 *
 * Deploy: Deploy > New deployment > Web app
 *   Execute as : Me
 *   Who has access : Anyone
 * Setiap ubah kode: Manage deployments > Edit > Version: New version (URL tetap).
 *
 * Alur: frontend POST {fn, args, token} (text/plain, tanpa preflight CORS).
 * - __login : cek username/password lewat attemptLogin() lama, balas token sesi (6 jam).
 * - lainnya : wajib token valid + fungsi ada di whitelist API_ROUTES.
 * - Argumen "user" SELALU diganti dari sesi server. Role dari klien tidak dipercaya.
 * =========================================================
 */

const API_SESSION_TTL = 21600; // detik, maksimum CacheService = 6 jam
const API_MAX_FAIL = 5;        // gagal login per username
const API_FAIL_WINDOW = 600;   // detik

/**
 * u     : indeks argumen yang diisi user sesi (kalau ada)
 * admin : true = hanya role Admin
 */
const API_ROUTES = {
  getDashboardData: {},
  getMasterData: {},
  savePelanggan: { u: 1 },
  saveBarang: { u: 1 },
  getRekeningList: {},
  saveRekening: { u: 1, admin: true },
  deleteRekening: { u: 1, admin: true },
  saveInvoiceAndGeneratePDF: { u: 1 },
  updateInvoiceAndGeneratePDF: { u: 1 },
  voidInvoice: { u: 1 },
  getTokoConfig: {},
  saveTokoConfig: { admin: true },
  uploadLogoToDrive: { admin: true },
  saveDraftInvoice: { u: 1 },
  updateDraftInvoice: { u: 1 },
  getDraftInvoiceList: {},
  getDraftById: {},
  getInvoiceById: {},
  deleteDraft: {},
  getPenawaranList: {},
  savePenawaran: { u: 1 },
  setStatusPenawaran: { u: 2 },
  deletePenawaranDraft: { u: 1 }
};

function apiHandlers_() {
  return {
    getDashboardData: getDashboardData,
    getMasterData: getMasterData,
    savePelanggan: savePelanggan,
    saveBarang: saveBarang,
    getRekeningList: getRekeningList,
    saveRekening: saveRekening,
    deleteRekening: deleteRekening,
    saveInvoiceAndGeneratePDF: saveInvoiceAndGeneratePDF,
    updateInvoiceAndGeneratePDF: updateInvoiceAndGeneratePDF,
    voidInvoice: voidInvoice,
    getTokoConfig: getTokoConfig,
    saveTokoConfig: saveTokoConfig,
    uploadLogoToDrive: uploadLogoToDrive,
    saveDraftInvoice: saveDraftInvoice,
    updateDraftInvoice: updateDraftInvoice,
    getDraftInvoiceList: getDraftInvoiceList,
    getDraftById: getDraftById,
    getInvoiceById: getInvoiceById,
    deleteDraft: deleteDraft,
    getPenawaranList: getPenawaranList,
    savePenawaran: savePenawaran,
    setStatusPenawaran: setStatusPenawaran,
    deletePenawaranDraft: deletePenawaranDraft
  };
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    out = apiHandle_(req);
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function apiHandle_(req) {
  const fn = String(req.fn || "");
  const args = Array.isArray(req.args) ? req.args.slice() : [];

  if (fn === "__login") return apiLogin_(args);
  if (fn === "__logout") {
    if (req.token) CacheService.getScriptCache().remove("sess_" + req.token);
    return { ok: true, data: null };
  }

  const user = apiSession_(req.token);
  if (!user) return { ok: false, auth: true, error: "Sesi habis. Login ulang." };

  const route = API_ROUTES[fn];
  const handler = apiHandlers_()[fn];
  if (!route || !handler) return { ok: false, error: "Fungsi tidak diizinkan: " + fn };
  if (route.admin && user.role !== "Admin") return { ok: false, error: "Hanya Admin yang boleh." };

  if (route.u !== undefined) {
    while (args.length <= route.u) args.push(null);
    args[route.u] = user; // paksa dari sesi server
  }

  const data = handler.apply(null, args);
  return { ok: true, data: data === undefined ? null : data };
}

function apiSession_(token) {
  if (!token || String(token).length < 32) return null;
  const raw = CacheService.getScriptCache().get("sess_" + token);
  return raw ? JSON.parse(raw) : null;
}

function apiLogin_(args) {
  const username = String(args[0] || "").trim();
  const password = String(args[1] || "");
  if (!username || !password) return { ok: false, error: "Username dan password wajib diisi." };

  const cache = CacheService.getScriptCache();
  const failKey = "fail_" + username.toLowerCase().substring(0, 60);
  const fails = parseInt(cache.get(failKey) || "0", 10);
  if (fails >= API_MAX_FAIL) {
    return { ok: false, error: "Terlalu banyak percobaan. Coba lagi 10 menit lagi." };
  }

  const r = attemptLogin(username, password); // fungsi lama di Kode.gs
  if (!r || !r.success) {
    cache.put(failKey, String(fails + 1), API_FAIL_WINDOW);
    return { ok: false, error: (r && r.message) || "Login gagal." };
  }
  cache.remove(failKey);

  const token = Utilities.getUuid() + Utilities.getUuid();
  cache.put("sess_" + token, JSON.stringify(r.user), API_SESSION_TTL);
  return { ok: true, data: { token: token, user: r.user } };
}

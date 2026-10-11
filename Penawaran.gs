/**
 * =========================================================
 * PENAWARAN (QUOTATION)
 * File baru. Pakai fungsi yang sudah ada di Kode.gs:
 * getDB, getSheetData, appendToSheet, updateInSheet, logAudit,
 * getTokoConfig, deleteDriveFileByUrl, SPREADSHEET_ID, FOLDER_ID, ttdStempelUrl
 * Sheet LOG_PENAWARAN dibuat otomatis kalau belum ada.
 * =========================================================
 */

const PENAWARAN_SHEET = "LOG_PENAWARAN";
const PENAWARAN_HEADERS = [
  "id_penawaran", "tanggal_penawaran", "tanggal_berlaku",
  "nama_pelanggan", "alamat_pelanggan", "telepon_pelanggan",
  "daftar_item_json", "subtotal", "diskon", "pajak", "ongkir", "grand_total",
  "syarat_ketentuan", "catatan_penawaran",
  "status_penawaran", "pdf_url", "id_invoice",
  "dibuat_oleh", "waktu_dibuat", "waktu_diubah"
];
const PENAWARAN_NUM_COLS = ["subtotal", "diskon", "pajak", "ongkir", "grand_total"];
const PENAWARAN_STATUS = ["Draft", "Final", "Disetujui", "Ditolak", "Void"];

function getPenawaranSheet_() {
  const ss = getDB();
  let sh = ss.getSheetByName(PENAWARAN_SHEET);
  if (!sh) {
    sh = ss.insertSheet(PENAWARAN_SHEET);
    sh.getRange(1, 1, 1, PENAWARAN_HEADERS.length).setValues([PENAWARAN_HEADERS]).setFontWeight("bold");
    sh.setFrozenRows(1);
    // Kolom teks: cegah Sheets mengubah "0812.." jadi angka atau "2026-10-11" jadi Date
    PENAWARAN_HEADERS.forEach(function (h, i) {
      if (PENAWARAN_NUM_COLS.indexOf(h) === -1) {
        sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1).setNumberFormat("@");
      }
    });
  }
  return sh;
}

function esc_(s) {
  return String(s === undefined || s === null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function rp_(n) {
  return "Rp " + (parseFloat(n) || 0).toLocaleString("id-ID");
}

/** Nomor urut harian: QUO-yyyyMMdd-001 */
function generateNomorPenawaran_() {
  const prefix = "QUO-" + Utilities.formatDate(new Date(), "GMT+7", "yyyyMMdd") + "-";
  const rows = getSheetData(PENAWARAN_SHEET);
  let max = 0;
  rows.forEach(function (r) {
    const id = String(r.id_penawaran || "");
    if (id.indexOf(prefix) === 0) {
      const n = parseInt(id.substring(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  });
  return prefix + ("00" + (max + 1)).slice(-3);
}

/** Dipanggil frontend saat buka menu riwayat penawaran */
function getPenawaranList() {
  getPenawaranSheet_();
  const rows = getSheetData(PENAWARAN_SHEET);
  rows.sort(function (a, b) {
    return String(b.id_penawaran).localeCompare(String(a.id_penawaran));
  });
  return rows;
}

/**
 * Simpan penawaran (baru atau edit).
 * mode: "draft" => status Draft, tanpa PDF
 *       "final" => generate PDF, status Final
 * Item boleh tanpa id_barang (item manual).
 */
function savePenawaran(data, user, mode) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const sh = getPenawaranSheet_();

    // Validasi
    const items = JSON.parse(data.daftar_item_json || "[]");
    if (!data.nama_pelanggan) throw new Error("Nama pelanggan wajib diisi.");
    if (!items.length) throw new Error("Minimal 1 item.");

    const isNew = !data.id_penawaran;
    let existing = null;
    if (!isNew) {
      existing = getSheetData(PENAWARAN_SHEET).filter(function (r) {
        return String(r.id_penawaran) === String(data.id_penawaran);
      })[0];
      if (!existing) throw new Error("Penawaran tidak ditemukan.");
      if (String(existing.status_penawaran) === "Void") throw new Error("Penawaran sudah Void.");
    } else {
      data.id_penawaran = generateNomorPenawaran_();
    }

    const now = new Date().toISOString();
    const rec = {
      id_penawaran: data.id_penawaran,
      tanggal_penawaran: data.tanggal_penawaran,
      tanggal_berlaku: data.tanggal_berlaku,
      nama_pelanggan: data.nama_pelanggan,
      alamat_pelanggan: data.alamat_pelanggan || "",
      telepon_pelanggan: data.telepon_pelanggan || "",
      daftar_item_json: JSON.stringify(items),
      subtotal: Number(data.subtotal) || 0,
      diskon: Number(data.diskon) || 0,
      pajak: Number(data.pajak) || 0,
      ongkir: Number(data.ongkir) || 0,
      grand_total: Number(data.grand_total) || 0,
      syarat_ketentuan: data.syarat_ketentuan || "",
      catatan_penawaran: data.catatan_penawaran || "",
      waktu_diubah: now
    };

    if (mode === "final") {
      if (existing && existing.pdf_url) deleteDriveFileByUrl(existing.pdf_url);
      rec.pdf_url = buildPenawaranPdf_(rec);
      rec.status_penawaran = "Final";
    } else {
      rec.status_penawaran = existing ? existing.status_penawaran : "Draft";
      if (existing && existing.status_penawaran === "Final") rec.status_penawaran = "Draft"; // diedit, perlu cetak ulang
      if (existing && existing.pdf_url && rec.status_penawaran === "Draft") rec.pdf_url = "";
    }

    if (isNew) {
      rec.id_invoice = "";
      rec.dibuat_oleh = user.username;
      rec.waktu_dibuat = now;
      appendToSheet(PENAWARAN_SHEET, rec);
    } else {
      updateInSheet(PENAWARAN_SHEET, "id_penawaran", rec.id_penawaran, rec);
    }

    logAudit(user.username, user.nama_lengkap, isNew ? "Create" : "Update", "Penawaran",
      rec.id_penawaran, mode === "final" ? "Generate PDF penawaran" : "Simpan draft penawaran");

    return {
      success: true,
      id_penawaran: rec.id_penawaran,
      pdfUrl: rec.pdf_url || ""
    };
  } catch (err) {
    return { success: false, message: err.message };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** Ubah status: Disetujui / Ditolak / Void / Draft */
function setStatusPenawaran(id, status, user, idInvoice) {
  try {
    if (PENAWARAN_STATUS.indexOf(status) === -1) throw new Error("Status tidak valid.");
    if (status === "Void" && (!user || user.role !== "Admin")) {
      throw new Error("Hanya Admin yang dapat Void.");
    }
    getPenawaranSheet_();
    const upd = { status_penawaran: status, waktu_diubah: new Date().toISOString() };
    if (idInvoice) upd.id_invoice = idInvoice;
    const ok = updateInSheet(PENAWARAN_SHEET, "id_penawaran", id, upd);
    if (!ok) throw new Error("Penawaran tidak ditemukan.");
    logAudit(user.username, user.nama_lengkap, "Status", "Penawaran", id, "Status jadi " + status);
    return { success: true, message: "Status diperbarui: " + status };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function deletePenawaranDraft(id, user) {
  try {
    const sh = getPenawaranSheet_();
    const values = sh.getDataRange().getValues();
    const head = values[0].map(function (h) { return String(h).trim(); });
    const cId = head.indexOf("id_penawaran");
    const cSt = head.indexOf("status_penawaran");
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][cId]) === String(id)) {
        if (String(values[i][cSt]) !== "Draft") throw new Error("Hanya Draft yang boleh dihapus. Gunakan Void.");
        sh.deleteRow(i + 1);
        logAudit(user.username, user.nama_lengkap, "Delete", "Penawaran", id, "Hapus draft penawaran");
        return { success: true };
      }
    }
    throw new Error("Penawaran tidak ditemukan.");
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/** Dashboard kecil: jumlah penawaran aktif bulan ini */
function getPenawaranStats() {
  const rows = getSheetData(PENAWARAN_SHEET);
  const now = new Date();
  let countMonth = 0, totalMonth = 0, open = 0;
  rows.forEach(function (r) {
    const st = String(r.status_penawaran);
    if (st === "Void") return;
    const d = new Date(r.tanggal_penawaran);
    if (!isNaN(d.getTime()) && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
      countMonth++;
      totalMonth += parseFloat(r.grand_total) || 0;
    }
    if (st === "Final") open++;
  });
  return { countMonth: countMonth, totalMonth: totalMonth, open: open };
}

/**
 * =========================================================
 * PDF PENAWARAN
 * =========================================================
 */
function buildPenawaranPdf_(q) {
  const toko = getTokoConfig();
  const logoUrl = imageToDataUri_(toko.logo_url); // fungsi ada di Kode.gs
  const ttdSrc = imageToDataUri_(ttdStempelUrl) || ttdStempelUrl;
  const namaPemilik = toko.nama_pemilik || "Pemilik Toko";
  const jabatanPemilik = toko.jabatan_pemilik || "Owner";

  const items = JSON.parse(q.daftar_item_json);
  let itemsHtml = "";
  items.forEach(function (it, i) {
    const qt = parseFloat(it.qty) || 0;
    const hg = parseFloat(it.harga) || 0;
    itemsHtml +=
      "<tr>" +
      '<td style="text-align:center;">' + (i + 1) + "</td>" +
      "<td>" + esc_(it.nama_barang) + "</td>" +
      '<td style="text-align:center;">' + qt + " " + esc_(it.satuan) + "</td>" +
      '<td style="text-align:right;">' + rp_(hg) + "</td>" +
      '<td style="text-align:right;">' + rp_(qt * hg) + "</td>" +
      "</tr>";
  });

  const syarat = q.syarat_ketentuan
    ? esc_(q.syarat_ketentuan).replace(/\r?\n/g, "<br>")
    : "";
  const catatan = q.catatan_penawaran
    ? esc_(q.catatan_penawaran).replace(/\r?\n/g, "<br>")
    : "";

  const rowIf = function (label, val, minus) {
    return (parseFloat(val) || 0) > 0
      ? '<tr><td class="sum-label">' + label + '</td><td class="sum-val">' + (minus ? "- " : "") + rp_(val) + "</td></tr>"
      : "";
  };

  const html = `
<html><head><style>
  @page { margin: 0; }
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color:#2b2b2b; margin:0;
         padding:40px 40px 80px 40px; background:#fff; font-size:13px; line-height:1.4; }
  .header { display:table; width:100%; margin-bottom:30px; }
  .header-left { display:table-cell; width:60%; vertical-align:top; }
  .header-right { display:table-cell; width:40%; vertical-align:top; text-align:right; }
  .brand-primary { font-size:24px; font-weight:800; letter-spacing:3px; color:#1a1a1a; line-height:1; }
  .brand-secondary { font-size:13px; font-weight:600; letter-spacing:6px; color:#e3b853; margin-top:2px; }
  .toko-info { font-size:12px; color:#666; margin:8px 0 0 0; }
  .doc-title { font-size:28px; font-weight:500; letter-spacing:2px; color:#c79850; margin:0; text-transform:uppercase; }
  .row-info { display:table; width:100%; margin-bottom:25px; }
  .col-customer { display:table-cell; width:55%; vertical-align:top; }
  .col-meta { display:table-cell; width:45%; vertical-align:top; }
  .label-title { font-weight:bold; color:#1a1a1a; margin-bottom:4px; }
  .customer-name { font-size:14px; font-weight:bold; color:#1a1a1a; }
  .meta-table { width:100%; border-collapse:collapse; }
  .meta-table td { padding:2px 0; }
  .meta-label { font-weight:bold; width:50%; }
  .meta-val { text-align:right; }
  table.items { width:100%; border-collapse:collapse; margin:15px 0 25px 0; }
  table.items th { border-top:1.5px solid #2c2c2c; border-bottom:1.5px solid #2c2c2c; padding:10px 6px; text-align:left; font-size:12px; }
  table.items td { border-bottom:1px solid #e0e0e0; padding:10px 6px; font-size:12px; color:#333; }
  .row-bottom { display:table; width:100%; table-layout:fixed; margin-top:15px; }
  .col-notes { display:table-cell; width:55%; vertical-align:top; padding-right:25px; }
  .col-summary { display:table-cell; width:45%; vertical-align:top; }
  .block { margin-bottom:15px; }
  .block strong { display:block; font-size:12px; text-transform:uppercase; letter-spacing:.5px; margin-bottom:4px; }
  .block div { font-size:12px; color:#555; line-height:1.5; }
  .summary-table { width:100%; border-collapse:collapse; }
  .summary-table td { padding:4px 0; font-size:13px; }
  .sum-label { font-weight:bold; text-align:right; padding-right:15px; }
  .sum-val { text-align:right; }
  .grand-total-row td { border-top:1.5px solid #2c2c2c; padding-top:8px !important; font-size:16px !important; font-weight:bold; }
  .signature-section { margin-top:40px; display:table; width:100%; }
  .thanks-note { display:table-cell; width:50%; vertical-align:bottom; font-size:14px; font-weight:bold; }
  .signature-group { display:table-cell; width:50%; text-align:right; vertical-align:bottom; }
  .signature-box { display:inline-block; width:220px; text-align:center; position:relative; }
  .signature-image { width:200px; height:auto; display:block; position:absolute; left:8px; top:-35px; z-index:10; }
  .owner-name { margin-top:60px; font-weight:bold; font-size:15px; position:relative; z-index:1; }
  .signature-title { font-size:11px; color:#666; margin-top:3px; }
  .watermark-container { position:fixed; bottom:35px; left:0; right:0; text-align:center; z-index:9; }
  .watermark-logo { width:200px; max-width:300px; height:auto; }
  .footer-banner { position:fixed; bottom:0; left:0; right:0; background:#e3b853; color:#fff;
                   text-align:center; padding:8px 20px; font-size:11px; z-index:10; }
</style></head><body>

<div class="header">
  <div class="header-left">
    <div class="brand-primary">DJOERAGAN</div>
    <div class="brand-secondary">BUMBU</div>
    <p class="toko-info">Jl. Raden Ronggo KG II/982, Prenggan Kotagede YK<br>Telp: 0812-3456-7982</p>
  </div>
  <div class="header-right"><div class="doc-title">QUOTATION</div></div>
</div>

<div class="row-info">
  <div class="col-customer">
    <div class="label-title">Kepada Yth:</div>
    <div class="customer-name">${esc_(q.nama_pelanggan)}</div>
    <div style="color:#555;margin-top:2px;">${esc_(q.alamat_pelanggan)}<br>Telp: ${esc_(q.telepon_pelanggan)}</div>
  </div>
  <div class="col-meta">
    <table class="meta-table">
      <tr><td class="meta-label">No. Penawaran</td><td class="meta-val">${esc_(q.id_penawaran)}</td></tr>
      <tr><td class="meta-label">Tanggal</td><td class="meta-val">${esc_(q.tanggal_penawaran)}</td></tr>
      <tr><td class="meta-label">Berlaku s/d</td><td class="meta-val">${esc_(q.tanggal_berlaku)}</td></tr>
    </table>
  </div>
</div>

<table class="items">
  <thead><tr>
    <th width="8%">No</th>
    <th width="42%">Deskripsi Barang</th>
    <th width="12%" style="text-align:center;">Qty</th>
    <th width="18%" style="text-align:right;">Harga Satuan</th>
    <th width="20%" style="text-align:right;">Total</th>
  </tr></thead>
  <tbody>${itemsHtml}</tbody>
</table>

<div class="row-bottom">
  <div class="col-notes">
    ${syarat ? '<div class="block"><strong>Syarat &amp; Ketentuan</strong><div>' + syarat + "</div></div>" : ""}
    ${catatan ? '<div class="block"><strong>Catatan</strong><div>' + catatan + "</div></div>" : ""}
  </div>
  <div class="col-summary">
    <table class="summary-table">
      <tr><td class="sum-label">Subtotal</td><td class="sum-val">${rp_(q.subtotal)}</td></tr>
      ${rowIf("Diskon", q.diskon, true)}
      ${rowIf("Pajak", q.pajak, false)}
      ${rowIf("Ongkir", q.ongkir, false)}
      <tr class="grand-total-row"><td class="sum-label">Total</td><td class="sum-val">${rp_(q.grand_total)}</td></tr>
    </table>
  </div>
</div>

<div class="signature-section">
  <div class="thanks-note">Terima kasih atas kepercayaan Anda.</div>
  <div class="signature-group">
    <div class="signature-box">
      <img src="${ttdSrc}" class="signature-image">
      <div class="owner-name">${esc_(namaPemilik)}</div>
      <div class="signature-title">${esc_(jabatanPemilik)}</div>
    </div>
  </div>
</div>

${logoUrl ? '<div class="watermark-container"><img src="' + logoUrl + '" class="watermark-logo"></div>' : ""}
<div class="footer-banner">Jl. Raden Ronggo KG II/982, Prenggan Kotagede YK &nbsp;|&nbsp; Telp: 0813-2074-8312</div>
</body></html>`;

  const blob = Utilities.newBlob(html, MimeType.HTML).setName(q.id_penawaran + ".pdf");
  const pdfFile = DriveApp.createFile(blob.getAs(MimeType.PDF));
  pdfFile.moveTo(DriveApp.getFolderById(FOLDER_ID));
  pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return pdfFile.getUrl();
}
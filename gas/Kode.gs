/**
 * =========================================================
 * KONFIGURASI SISTEM
 * =========================================================
 */
const SPREADSHEET_ID = "1DS9REn_RwFccaqDvIgwDGC7zjVnF6lLfoNYuvGe5Jo0"; 
const FOLDER_ID = "1t88MnBM60CooYbS8PSXXt2lDn-Wwp1mQ";
const ttdStempelUrl = "https://drive.google.com/uc?export=view&id=1ecoqS4wBHVi4mBT0mh-_wIxuKkUswefL";


function doGet(e) {
  Logger.log("VERSION = 2026-08-04-1235");
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Djoeragan Bumbu - Invoice Management')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * =========================================================
 * UTILITAS & DATABASE
 * =========================================================
 */
function getDB() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getSheetData(sheetName) {
  const sheet = getDB().getSheetByName(sheetName);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  // Trim nama header agar tidak ada bug spasi tak terlihat
  const headers = data[0].map(h => String(h).trim());
  const rows = data.slice(1);
  return rows.map(row => {
    let obj = {};
    headers.forEach((header, index) => {
      if (header) {
        let val = row[index];
        // Format objek Date menjadi string YYYY-MM-DD
        if (val instanceof Date) {
          val = Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd");
        }
        obj[header] = val;
      }
    });
    return obj;
  });
}

function appendToSheet(sheetName, dataObj) {
  const sheet = getDB().getSheetByName(sheetName);
  const headers = sheet.getDataRange().getValues()[0].map(h => String(h).trim());
  const rowData = headers.map(header => dataObj[header] !== undefined ? dataObj[header] : "");
  sheet.appendRow(rowData);
  return true;
}

function updateSheetById(sheetName, idInvoice, data) {
  const ss = getDB();
  const sh = ss.getSheetByName(sheetName);
  if (!sh) {
    throw new Error("Sheet " + sheetName + " tidak ditemukan.");
  }
  const values = sh.getDataRange().getValues();
  if (values.length < 2) {
    throw new Error("Data kosong.");
  }
  const headers = values[0];
  const idCol = headers.indexOf("id_invoice");
  if (idCol === -1) {
    throw new Error("Kolom id_invoice tidak ditemukan.");
  }
  let row = -1;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idCol]) === String(idInvoice)) {
      row = i + 1;
      break;
    }
  }
  if (row === -1) {
    throw new Error("Invoice tidak ditemukan.");
  }
  const rowData = headers.map(function(h){
    if(data[h] === undefined){
        const col = headers.indexOf(h);
        return values[row-1][col];
    }
    return data[h];
  });
  sh.getRange(row, 1, 1, rowData.length).setValues([rowData]);
  return row;
}

function deleteDriveFileByUrl(fileUrl) {

  if (!fileUrl) return;

  try {

    const match = fileUrl.match(/[-\w]{25,}/);

    if (!match) return;

    const fileId = match[0];

    DriveApp.getFileById(fileId).setTrashed(true);

  } catch (e) {
    Logger.log(e);
  }

}

function updateInSheet(sheetName, idColumn, idValue, dataObj) {
  const sheet = getDB().getSheetByName(sheetName);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());
  const idColIndex = headers.indexOf(idColumn);
  if (idColIndex === -1) return false;
  for (let i = 1; i < data.length; i++) {
    if (data[i][idColIndex] == idValue) {
      const rowNum = i + 1;
      headers.forEach((header, colIndex) => {
        if (dataObj[header] !== undefined) {
          sheet.getRange(rowNum, colIndex + 1).setValue(dataObj[header]);
        }
      });
      return true;
    }
  }
  return false;
}

function logAudit(username, namaUser, aktivitas, modul, idData, detail) {
  const logData = {
    waktu: new Date().toISOString(),
    username: username,
    nama_user: namaUser,
    aktivitas: aktivitas,
    modul: modul,
    id_data: idData,
    detail: detail
  };
  appendToSheet("AUDIT_LOG", logData);
}

function hashPassword(password) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password);
  let hashStr = '';
  for (let i = 0; i < digest.length; i++) {
    let byteStr = (digest[i] < 0 ? digest[i] + 256 : digest[i]).toString(16);
    if (byteStr.length == 1) byteStr = '0' + byteStr;
    hashStr += byteStr;
  }
  return hashStr;
}

/**
 * =========================================================
 * AUTHENTICATION (LOGIN)
 * =========================================================
 */
function attemptLogin(username, password) {
  const users = getSheetData("MASTER_USER");
  const hash = hashPassword(password);
  
  for (let i = 0; i < users.length; i++) {
    if (users[i].username === username && users[i].password_hash === hash) {
      if (String(users[i].status_aktif) === "0") return { success: false, message: "Akun nonaktif." };
      
      updateInSheet("MASTER_USER", "id_user", users[i].id_user, { last_login: new Date().toISOString() });
      logAudit(users[i].username, users[i].nama_lengkap, "Login", "Auth", users[i].id_user, "User berhasil login");
      
      return {
        success: true,
        user: {
          id_user: users[i].id_user,
          username: users[i].username,
          nama_lengkap: users[i].nama_lengkap,
          role: users[i].role
        }
      };
    }
  }
  return { success: false, message: "Username atau Password salah." };
}

/**
 * =========================================================
 * DASHBOARD & DATA LOADING
 * =========================================================
 */
function getDashboardData() {
  const invoices = getSheetData("LOG_INVOICE");
  const today = new Date();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  
  let countToday = 0, countMonth = 0;
  let totalToday = 0, totalMonth = 0;
  
  invoices.forEach(inv => {
    if (String(inv.status_invoice).toLowerCase() === "void") return;
    if (!inv.tanggal_invoice) return;

    const invDate = new Date(inv.tanggal_invoice);
    if (isNaN(invDate.getTime())) return;

    if (invDate.getMonth() === currentMonth && invDate.getFullYear() === currentYear) {
      countMonth++;
      let gTotal = parseFloat(String(inv.grand_total).replace(/[^0-9.-]/g, '')) || 0;
      totalMonth += gTotal;
      
      if (invDate.getDate() === today.getDate()) {
        countToday++;
        totalToday += gTotal;
      }
    }
  });
  
  return { countToday, countMonth, totalToday, totalMonth };
}

// Fungsi penentu status aktif yang fleksibel
function isAktif(val) {
  if (val === undefined || val === null || val === "") return true; // Tampilkan jika tidak diisi
  const str = String(val).trim().toLowerCase();
  return str === "1" || str === "true" || str === "aktif" || str === "active";
}

function getMasterData() {
  const pelanggan = getSheetData("MASTER_PELANGGAN").filter(p => isAktif(p.status_aktif));
  const barang = getSheetData("MASTER_BARANG").filter(b => isAktif(b.status_aktif));
  const invoice = getSheetData("LOG_INVOICE");

  return { pelanggan, barang, invoice };
}

/**
 * =========================================================
 * CRUD MASTER PELANGGAN
 * =========================================================
 */
function savePelanggan(data, user) {
  if (!data.id_pelanggan) {
    data.id_pelanggan = "CUST-" + new Date().getTime();
    data.tanggal_dibuat = new Date().toISOString();
    data.tanggal_diubah = data.tanggal_dibuat;
    data.status_aktif = 1;
    appendToSheet("MASTER_PELANGGAN", data);
    logAudit(user.username, user.nama_lengkap, "Tambah", "Pelanggan", data.id_pelanggan, "Menambah pelanggan baru");
  } else {
    data.tanggal_diubah = new Date().toISOString();
    updateInSheet("MASTER_PELANGGAN", "id_pelanggan", data.id_pelanggan, data);
    logAudit(user.username, user.nama_lengkap, "Edit", "Pelanggan", data.id_pelanggan, "Mengedit pelanggan");
  }
  return { success: true, message: "Data pelanggan berhasil disimpan." };
}

/**
 * =========================================================
 * CRUD MASTER BARANG
 * =========================================================
 */
function saveBarang(data, user) {
  if (!data.id_barang) {
    data.id_barang = "BRG-" + new Date().getTime();
    data.tanggal_dibuat = new Date().toISOString();
    data.tanggal_diubah = data.tanggal_dibuat;
    data.status_aktif = 1;
    appendToSheet("MASTER_BARANG", data);
    logAudit(user.username, user.nama_lengkap, "Tambah", "Barang", data.id_barang, "Menambah barang baru");
  } else {
    data.tanggal_diubah = new Date().toISOString();
    updateInSheet("MASTER_BARANG", "id_barang", data.id_barang, data);
    logAudit(user.username, user.nama_lengkap, "Edit", "Barang", data.id_barang, "Mengedit barang");
  }
  return { success: true, message: "Data barang berhasil disimpan." };
}

/* =====================================================
   CRUD MASTER REKENING OWNER
===================================================== */

function getRekeningList() {

  return getSheetData("MASTER_REKENING")
    .filter(function(r){
      return isAktif(r.status_aktif);
    });

}

function saveRekening(data,user){

  if(!data.id_rekening){

    data.id_rekening = "REK-" + new Date().getTime();
    data.status_aktif = 1;
    data.tanggal_dibuat = new Date().toISOString();
    data.tanggal_diubah = data.tanggal_dibuat;

    appendToSheet("MASTER_REKENING",data);

    logAudit(
      user.username,
      user.nama_lengkap,
      "Tambah",
      "Rekening",
      data.id_rekening,
      "Tambah rekening owner"
    );

  }else{

    data.tanggal_diubah = new Date().toISOString();

    updateInSheet(
      "MASTER_REKENING",
      "id_rekening",
      data.id_rekening,
      data
    );

    logAudit(
      user.username,
      user.nama_lengkap,
      "Edit",
      "Rekening",
      data.id_rekening,
      "Edit rekening owner"
    );

  }

  return {
    success:true,
    message:"Rekening berhasil disimpan."
  };

}

function deleteRekening(id,user){

  updateInSheet(
    "MASTER_REKENING",
    "id_rekening",
    id,
    {
      status_aktif:0,
      tanggal_diubah:new Date().toISOString()
    }
  );

  logAudit(
    user.username,
    user.nama_lengkap,
    "Hapus",
    "Rekening",
    id,
    "Nonaktif rekening owner"
  );

  return {
    success:true,
    message:"Rekening berhasil dihapus."
  };

}

/**
 * =========================================================
 * INVOICE & PDF GENERATION
 * =========================================================
 */
/**
 * Ubah file gambar Drive jadi data URI (base64) untuk disisipkan ke HTML sebelum jadi PDF.
 * Konverter HTML->PDF sering gagal mengambil gambar dari URL drive.google.com/uc
 * (redirect, kuota, belum sharing) dan menggambar ikon "gambar rusak" (kotak retak).
 * Mime dideteksi dari isi file, bukan dari label Drive.
 * Return "" kalau file tidak ada / format tidak didukung (PNG, JPG, GIF).
 */
function imageToDataUri_(url) {
  if (!url) return "";
  try {
    const u = String(url);
    if (u.indexOf("data:") === 0) return u;
    const m = u.match(/[-\w]{25,}/);
    if (!m) return "";
    const bytes = DriveApp.getFileById(m[0]).getBlob().getBytes();
    let mime = "";
    if (bytes[0] === -119 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) mime = "image/png";
    else if (bytes[0] === -1 && bytes[1] === -40) mime = "image/jpeg";
    else if (bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) mime = "image/gif";
    if (!mime) {
      Logger.log("Format gambar tidak didukung (bukan PNG/JPG/GIF): " + u);
      return "";
    }
    return "data:" + mime + ";base64," + Utilities.base64Encode(bytes);
  } catch (e) {
    Logger.log("imageToDataUri_ gagal: " + e);
    return "";
  }
}

function saveInvoiceAndGeneratePDF(invoiceData, user) {
 let lock = null;
 try {
 lock = LockService.getScriptLock();
 lock.waitLock(30000); // jaga nomor urut tidak bentrok saat 2 user proses bersamaan
 if (!invoiceData.id_invoice || String(invoiceData.id_invoice).indexOf("DRF-") === 0) {
  invoiceData.id_invoice = generateNomorInvoice_();
 }

 // Ambil konfigurasi toko
 const tokoConfig = getTokoConfig();
 const logoUrl = imageToDataUri_(tokoConfig.logo_url);
 const ttdSrc = imageToDataUri_(ttdStempelUrl) || ttdStempelUrl;
 const namaPemilik = tokoConfig.nama_pemilik || "Pemilik Toko";
 const jabatanPemilik = tokoConfig.jabatan_pemilik || "Owner";
 const rekeningHtml = buildRekeningHtml(invoiceData.rekening_tujuan);
 
 let itemsHtml = "";
 const items = JSON.parse(invoiceData.daftar_item_json);
 items.forEach((item, index) => {
 const hg = parseFloat(item.harga) || 0;
 const qt = parseFloat(item.qty) || 0;
 itemsHtml += `
 <tr>
 <td style="padding: 8px; border: 1px solid #ddd; text-align:center;">${index + 1}</td>
 <td style="padding: 8px; border: 1px solid #ddd;">${item.nama_barang}</td>
 <td style="padding: 8px; border: 1px solid #ddd; text-align:center;">${qt} ${item.satuan}</td>
 <td style="padding: 8px; border: 1px solid #ddd; text-align:right;">Rp ${hg.toLocaleString('id-ID')}</td>
 <td style="padding: 8px; border: 1px solid #ddd; text-align:right;">Rp ${(qt * hg).toLocaleString('id-ID')}</td>
 </tr>
 `;
 });
 
// Template HTML dengan Text Logo & Watermark Logo di Bawah
const htmlTemplate = `
<html>
<head>
<style>
  @page {
    margin: 0;
  }
  body { 
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; 
    color: #2b2b2b; 
    margin: 0; 
    padding: 40px 40px 80px 40px; 
    background-color: #ffffff;
    font-size: 13px;
    line-height: 1.4;
  }
  
  /* Header Section */
  .header { 
    display: table; 
    width: 100%; 
    margin-bottom: 30px; 
  }
  .header-left { 
    display: table-cell; 
    width: 60%; 
    vertical-align: top; 
  }
  .header-right { 
    display: table-cell; 
    width: 40%; 
    vertical-align: top; 
    text-align: right; 
  }

  /* Typography Text Logo */
  .brand-logo {
    margin-bottom: 8px;
  }
  .brand-primary {
    font-size: 24px;
    font-weight: 800;
    letter-spacing: 3px;
    color: #1a1a1a;
    line-height: 1;
  }
  .brand-secondary {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 6px;
    color: #e3b853; /* Aksen warna emas */
    margin-top: 2px;
    line-height: 1.2;
  }

  .toko-info { 
    font-size: 12px; 
    color: #666666;
    margin: 0; 
    line-height: 1.4; 
  }
  .invoice-title { 
    font-size: 28px; 
    font-weight: 500; 
    letter-spacing: 2px; 
    color: #c79850; 
    margin: 0; 
    text-transform: uppercase;
  }
  
  /* Customer & Metadata Row */
  .row-info { 
    display: table; 
    width: 100%; 
    margin-bottom: 25px; 
  }
  .col-customer { 
    display: table-cell; 
    width: 55%; 
    vertical-align: top; 
  }
  .col-meta { 
    display: table-cell; 
    width: 45%; 
    vertical-align: top; 
  }
  .label-title {
    font-weight: bold;
    color: #1a1a1a;
    margin-bottom: 4px;
    font-size: 13px;
  }
  .customer-name {
    font-size: 14px;
    font-weight: bold;
    color: #1a1a1a;
  }
  .meta-table {
    width: 100%;
    border-collapse: collapse;
  }
  .meta-table td {
    padding: 2px 0;
    font-size: 13px;
  }
  .meta-table td.meta-label {
    font-weight: bold;
    color: #1a1a1a;
    width: 50%;
  }
  .meta-table td.meta-val {
    text-align: right;
    color: #333;
  }

  /* Items Table Minimalist Style */
  table.items { 
    width: 100%; 
    border-collapse: collapse; 
    margin-top: 15px; 
    margin-bottom: 25px; 
  }
  table.items th { 
    border-top: 1.5px solid #2c2c2c; 
    border-bottom: 1.5px solid #2c2c2c; 
    color: #1a1a1a; 
    padding: 10px 6px; 
    font-weight: bold;
    text-align: left;
    font-size: 12px;
  }
  table.items td { 
    border-bottom: 1px solid #e0e0e0; 
    padding: 10px 6px; 
    font-size: 12px; 
    color: #333333;
  }

  /* Payment Details & Summary Row */
  .row-bottom{
    display:table;
    width:100%;
    table-layout:fixed;
    margin-top:15px;
}

.col-notes{
    display:table-cell;
    width:55%;
    vertical-align:top;
    padding-right:25px;
}

.col-summary{
    display:table-cell;
    width:45%;
    vertical-align:top;
}
  
  .payment-block{
    margin-bottom:15px;
}

.payment-content{
    min-height:85px;
}
  .payment-block strong {
    display: block;
    font-size: 12px;
    text-transform: uppercase;
    color: #1a1a1a;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }

  .summary-table {
    width: 100%;
    border-collapse: collapse;
  }
  .summary-table td {
    padding: 4px 0;
    font-size: 13px;
  }
  .summary-table td.sum-label {
    font-weight: bold;
    color: #1a1a1a;
    text-align: right;
    padding-right: 15px;
  }
  .summary-table td.sum-val {
    text-align: right;
    color: #1a1a1a;
  }
  .grand-total-row td {
    border-top: 1.5px solid #2c2c2c;
    padding-top: 8px !important;
    font-size: 16px !important;
    font-weight: bold;
  }

  /* Footer & Signature Section */
  .signature-section { 
    margin-top: 40px; 
    display: table; 
    width: 100%; 
  }
  .thanks-note {
    display: table-cell;
    width: 50%;
    vertical-align: bottom;
    font-size: 14px;
    font-weight: bold;
    color: #2c2c2c;
  }
  .signature-group {
    display: table-cell;
    width: 50%;
    text-align: right;
    vertical-align: bottom;
  }
  .signature-box{
    display:inline-block;
    width:220px;
    text-align:center;
    margin-left:15px;
    vertical-align:top;
    overflow:visible;
    position:relative;
  }
  .signature-image{
    width:200px;
    height:auto;
    display:block;
    position:absolute;
    left:8px;
    top:-35px;
    z-index:10;
    pointer-events:none;
}

.owner-name{
    margin-top:60px;
    font-weight:bold;
    font-size:15px;
    color:#1a1a1a;
    position:relative;
    z-index:1;
}

.signature-title{
    font-size:11px;
    color:#666;
    margin-top:3px;
}

/* ================================
   Footer Watermark Logo
================================ */
.watermark-container {
    position: fixed;
    bottom: 35px;          /* Terkunci tepat di atas footer-banner */
    left: 0;
    right: 0;
    width: 100%;
    text-align: center;
    z-index: 9;
    pointer-events: none;  /* Supaya tidak menghalangi kursor/klik */
}

.watermark-logo {
    width: 200px;
    max-width: 300px;
    height: auto;
    opacity: 1;          /* Opsional: Ubah ke 0.1 - 0.5 jika ingin transparan (nilai CSS 0 sampai 1) */
}

/* Bottom Gold Banner */
.footer-banner {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background-color: #e3b853; 
    color: #ffffff;
    text-align: center;
    padding: 8px 20px;
    font-size: 11px;
    letter-spacing: 0.5px;
    z-index: 10;
}
</style>
</head>
<body>

<div class="header">
  <div class="header-left">
    <div class="brand-logo">
      <div class="brand-primary">DJOERAGAN</div>
      <div class="brand-secondary">BUMBU</div>
    </div>
    <p class="toko-info">Jl. Raden Ronggo KG II/982, Prenggan Kotagede YK<br>Telp: 0812-3456-7982</p>
  </div>
  <div class="header-right">
    <div class="invoice-title">INVOICE</div>
  </div>
</div>

<div class="row-info">
  <div class="col-customer">
    <div class="label-title">Invoice to:</div>
    <div class="customer-name">${invoiceData.nama_pelanggan}</div>
    <div style="color: #555; margin-top: 2px;">
      ${invoiceData.alamat_pelanggan}<br>
      Telp: ${invoiceData.telepon_pelanggan}
    </div>
  </div>
  <div class="col-meta">
    <table class="meta-table">
      <tr>
        <td class="meta-label">Invoice#</td>
        <td class="meta-val">${invoiceData.id_invoice}</td>
      </tr>
      <tr>
        <td class="meta-label">Date</td>
        <td class="meta-val">${invoiceData.tanggal_invoice}</td>
      </tr>
      <tr>
        <td class="meta-label">Pay by</td>
        <td class="meta-val">${invoiceData.tanggal_jatuh_tempo}</td>
      </tr>
      <tr>
        <td class="meta-label">Method</td>
        <td class="meta-val">${invoiceData.metode_pembayaran}</td>
      </tr>
    </table>
  </div>
</div>

<table class="items">
  <thead>
    <tr>
      <th width="8%">No</th>
      <th width="42%">Deskripsi Barang</th>
      <th width="12%" style="text-align:center;">Qty</th>
      <th width="18%" style="text-align:right;">Harga Satuan</th>
      <th width="20%" style="text-align:right;">Total</th>
    </tr>
  </thead>
  <tbody>
    ${itemsHtml}
  </tbody>
</table>

<div class="row-bottom">

    <div class="col-notes">

        <div class="payment-block">
            <strong>Payment Method</strong>
            <!-- Tambahkan class="payment-content" di div ini agar tingginya tidak kolaps -->
            <div class="payment-content" style="font-size:12px;color:#444;line-height:1.5;">
                ${rekeningHtml}
            </div>
        </div>

        <div class="payment-block">

            <strong>Catatan</strong>

            <div style="font-size:12px;color:#555;">
                ${invoiceData.catatan_invoice || "-"}
            </div>

        </div>

    </div>

    <div class="col-summary">

        <table class="summary-table">

            <tr>
                <td class="sum-label">Subtotal</td>
                <td class="sum-val">Rp ${(parseFloat(invoiceData.subtotal)||0).toLocaleString('id-ID')}</td>
            </tr>

            <tr>
                <td class="sum-label">Diskon</td>
                <td class="sum-val">Rp ${(parseFloat(invoiceData.diskon)||0).toLocaleString('id-ID')}</td>
            </tr>

            <tr>
                <td class="sum-label">Pajak</td>
                <td class="sum-val">Rp ${(parseFloat(invoiceData.pajak)||0).toLocaleString('id-ID')}</td>
            </tr>

            <tr>
                <td class="sum-label">Ongkir</td>
                <td class="sum-val">Rp ${(parseFloat(invoiceData.ongkir)||0).toLocaleString('id-ID')}</td>
            </tr>

            <tr>
                <td class="sum-label">DP / Uang Muka</td>
                <td class="sum-val">- Rp ${(parseFloat(invoiceData.dp)||0).toLocaleString('id-ID')}</td>
            </tr>

            <tr class="grand-total-row">
                <td class="sum-label">Total</td>
                <td class="sum-val">Rp ${(parseFloat(invoiceData.grand_total)||0).toLocaleString('id-ID')}</td>
            </tr>

        </table>

    </div>

</div>

<div class="signature-section">
  <div class="thanks-note">
    Thank you for your business!
  </div>
  <div class="signature-group">
    <div class="signature-box">
        <img src="${ttdSrc}" class="signature-image">
        <div class="owner-name">
           ${namaPemilik}
        </div>
        <div class="signature-title">
            ${jabatanPemilik}
        </div>
    </div>
  </div>
</div>

<!-- Watermark Logo Kecil -->
${logoUrl ? '<div class="watermark-container"><img src="' + logoUrl + '" class="watermark-logo" alt="Watermark Logo"></div>' : ''}

<div class="footer-banner">
  Jl. Raden Ronggo KG II/982, Prenggan Kotagede YK &nbsp;|&nbsp; Telp: 0813-2074-8312
</div>

</body>
</html>
`;
 
 const blob = Utilities.newBlob(htmlTemplate, MimeType.HTML).setName(invoiceData.id_invoice + ".pdf");
 const pdfFile = DriveApp.createFile(blob.getAs(MimeType.PDF));
 const folder = DriveApp.getFolderById(FOLDER_ID);
 pdfFile.moveTo(folder);
 
 pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
 const pdfUrl = pdfFile.getUrl();
 
 invoiceData.pdf_url = pdfUrl;
 invoiceData.status_invoice = "Final";
 invoiceData.status_pembayaran = "Belum Lunas";
 invoiceData.dibuat_oleh = user.username;
 invoiceData.waktu_dibuat = new Date().toISOString();
 invoiceData.waktu_diubah = invoiceData.waktu_dibuat;
 
 appendToSheet("LOG_INVOICE", invoiceData);
 logAudit(user.username, user.nama_lengkap, "Create", "Invoice", invoiceData.id_invoice, "Generate invoice PDF");
 
 return {

  success: true,

  id_invoice: invoiceData.id_invoice,

  pdfUrl: pdfUrl

};
 } catch (err) {
 return { success: false, message: err.message };
 } finally {
 try { lock.releaseLock(); } catch (e) {}
 }
}

/**
 * Nomor urut harian: INV-yyyyMMdd-001, 002, ...
 * Nomor lama berformat acak 4 digit diabaikan.
 */
function generateNomorInvoice_() {
  const prefix = "INV-" + Utilities.formatDate(new Date(), "GMT+7", "yyyyMMdd") + "-";
  let max = 0;
  getSheetData("LOG_INVOICE").forEach(function (r) {
    const id = String(r.id_invoice || "");
    if (id.indexOf(prefix) === 0) {
      const suf = id.substring(prefix.length);
      if (/^\d{3}$/.test(suf)) {
        const n = parseInt(suf, 10);
        if (n > max) max = n;
      }
    }
  });
  const next = max + 1;
  return prefix + (next < 10 ? "00" + next : next < 100 ? "0" + next : String(next));
}

function updateInvoiceAndGeneratePDF(invoiceData, user) {

  try {

    if (!invoiceData.id_invoice) {
      throw new Error("ID Invoice tidak ditemukan.");
    }

    var oldData = getInvoiceById(invoiceData.id_invoice);

    if (!oldData.success) {
      throw new Error("Invoice tidak ditemukan.");
    }

    if (oldData.data.pdf_url) {
      deleteDriveFileByUrl(oldData.data.pdf_url);
    }

    // =====================================================
    // Generate PDF Baru (menggunakan ID Invoice lama)
    // =====================================================

    const tokoConfig = getTokoConfig();
    const logoUrl = tokoConfig.logo_url || "";
    const ttdSrc = imageToDataUri_(ttdStempelUrl) || ttdStempelUrl;
    const namaPemilik = tokoConfig.nama_pemilik || "Pemilik Toko";
    const jabatanPemilik = tokoConfig.jabatan_pemilik || "Owner";

    let itemsHtml = "";
    const items = JSON.parse(invoiceData.daftar_item_json);

    items.forEach(function(item, index){

      var hg = parseFloat(item.harga) || 0;
      var qt = parseFloat(item.qty) || 0;

      itemsHtml += `
      <tr>
        <td style="padding:8px;border:1px solid #ddd;text-align:center;">${index+1}</td>
        <td style="padding:8px;border:1px solid #ddd;">${item.nama_barang}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:center;">${qt} ${item.satuan}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">Rp ${hg.toLocaleString('id-ID')}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">Rp ${(hg*qt).toLocaleString('id-ID')}</td>
      </tr>`;
    });


    var rekeningHtml = buildRekeningHtml(invoiceData.rekening_tujuan);
    var html = `
<html>
<body style="font-family:Arial;padding:25px;">
<h2>INVOICE</h2>

<table width="100%">
<tr>
<td>
<b>${invoiceData.nama_pelanggan}</b><br>
${invoiceData.alamat_pelanggan}<br>
${invoiceData.telepon_pelanggan}
</td>

<td align="right">
No : ${invoiceData.id_invoice}<br>
Tanggal : ${invoiceData.tanggal_invoice}<br>
Tempo : ${invoiceData.tanggal_jatuh_tempo}
</td>
</tr>
</table>

<br>

<table width="100%" cellspacing="0" cellpadding="5" border="1">
<tr bgcolor="#eeeeee">
<th>No</th>
<th>Barang</th>
<th>Qty</th>
<th>Harga</th>
<th>Total</th>
</tr>

${itemsHtml}

</table>

<br>

<table width="320" align="right">
<tr><td>Subtotal</td><td align="right">Rp ${(parseFloat(invoiceData.subtotal)||0).toLocaleString('id-ID')}</td></tr>
<tr><td>Diskon</td><td align="right">Rp ${(parseFloat(invoiceData.diskon)||0).toLocaleString('id-ID')}</td></tr>
<tr><td>Pajak</td><td align="right">Rp ${(parseFloat(invoiceData.pajak)||0).toLocaleString('id-ID')}</td></tr>
<tr><td>Ongkir</td><td align="right">Rp ${(parseFloat(invoiceData.ongkir)||0).toLocaleString('id-ID')}</td></tr>
<tr><td>DP / Uang Muka</td><td align="right">- Rp ${(parseFloat(invoiceData.dp)||0).toLocaleString('id-ID')}</td></tr>
<tr><th>Total</th><th align="right">Rp ${(parseFloat(invoiceData.grand_total)||0).toLocaleString('id-ID')}</th></tr>
</table>

<br><br><br>

<div style="clear:both;"></div>

<div class="payment-block">
    <strong>Payment Method</strong>
    <div style="color:#444;font-size:12px;line-height:1.4;">
        ${rekeningHtml}
    </div>
</div>

<br>
<div style="text-align:right">

${logoUrl ? '<img src="'+ttdSrc+'" width="170"><br>' : ""}

<b>${namaPemilik}</b><br>

${jabatanPemilik}

</div>

</body>
</html>`;

    var blob = Utilities.newBlob(html,MimeType.HTML)
      .getAs(MimeType.PDF)
      .setName(invoiceData.id_invoice + ".pdf");

    var folder = DriveApp.getFolderById(FOLDER_ID);

    var pdf = folder.createFile(blob);

    pdf.setSharing(
      DriveApp.Access.ANYONE_WITH_LINK,
      DriveApp.Permission.VIEW
    );

    invoiceData.pdf_url = pdf.getUrl();

    invoiceData.status_invoice = "Final";

    invoiceData.status_pembayaran =
      oldData.data.status_pembayaran || "Belum Lunas";

    invoiceData.dibuat_oleh =
      oldData.data.dibuat_oleh;

    invoiceData.waktu_dibuat =
      oldData.data.waktu_dibuat;

    invoiceData.waktu_diubah =
      new Date().toISOString();

    updateSheetById(
      "LOG_INVOICE",
      invoiceData.id_invoice,
      invoiceData
    );

    logAudit(
      user.username,
      user.nama_lengkap,
      "Update",
      "Invoice",
      invoiceData.id_invoice,
      "Edit Invoice + Regenerate PDF"
    );

    return {

      success:true,

      id_invoice:invoiceData.id_invoice,

      pdfUrl:invoiceData.pdf_url

    };

  } catch(err){

    return{

      success:false,

      message:err.toString()

    };

  }

}



function voidInvoice(id_invoice, user) {
  if (!user || user.role !== 'Admin') return { success: false, message: "Hanya Admin yang dapat melakukan Void." };
  updateInSheet("LOG_INVOICE", "id_invoice", id_invoice, { status_invoice: "Void", waktu_diubah: new Date().toISOString() });
  logAudit(user.username, user.nama_lengkap, "Void", "Invoice", id_invoice, "Void invoice");
  return { success: true, message: "Invoice berhasil divoid." };
}

function testHash() {
  Logger.log(hashPassword("admin123"));
}

/**
 * =========================================================
 * KONFIGURASI TOKO (LOGO & PEMILIK)
 * =========================================================
 */
function getTokoConfig() {
 const sheet = getDB().getSheetByName("CONFIG_TOKO");
 if (!sheet) {
   // Jika sheet belum ada, buat sheet baru
   const db = getDB();
   const newSheet = db.insertSheet("CONFIG_TOKO");
   newSheet.appendRow(["logo_url", "nama_pemilik", "jabatan_pemilik"]);
   newSheet.appendRow(["", "Pemilik Toko", "Owner"]);
   return { logo_url: "", nama_pemilik: "Pemilik Toko", jabatan_pemilik: "Owner" };
 }
 
 const data = sheet.getDataRange().getValues();
 if (data.length < 2) {
   return { logo_url: "", nama_pemilik: "Pemilik Toko", jabatan_pemilik: "Owner" };
 }
 
 const headers = data[0];
 const values = data[1];
 let config = {};
 headers.forEach((header, index) => {
   config[header] = values[index] || "";
 });
 
 return config;
}

function saveTokoConfig(configData) {
 let sheet = getDB().getSheetByName("CONFIG_TOKO");
 if (!sheet) {
   const db = getDB();
   sheet = db.insertSheet("CONFIG_TOKO");
   sheet.appendRow(["logo_url", "nama_pemilik", "jabatan_pemilik"]);
 }
 
 const data = sheet.getDataRange().getValues();
 if (data.length < 2) {
   sheet.appendRow([configData.logo_url || "", configData.nama_pemilik || "Pemilik Toko", configData.jabatan_pemilik || "Owner"]);
 } else {
   sheet.getRange(2, 1).setValue(configData.logo_url || "");
   sheet.getRange(2, 2).setValue(configData.nama_pemilik || "Pemilik Toko");
   sheet.getRange(2, 3).setValue(configData.jabatan_pemilik || "Owner");
 }
 
 return { success: true, message: "Konfigurasi toko berhasil disimpan." };
}

function uploadLogoToDrive(base64Data, fileName) {
 try {
   // Hapus prefix "data:image/...;base64,"
   const mm = String(base64Data).match(/^data:(image\/[a-z]+);base64,/i);
   const mime = mm ? mm[1].toLowerCase() : "";
   if (["image/png", "image/jpeg", "image/gif"].indexOf(mime) === -1) {
     return { success: false, message: "Format harus PNG, JPG, atau GIF (WebP/SVG tidak didukung PDF)." };
   }
   const base64String = base64Data.split(',')[1];
   const blob = Utilities.newBlob(Utilities.base64Decode(base64String), mime, fileName);
   
   const folder = DriveApp.getFolderById(FOLDER_ID);
   
   // Hapus logo lama jika ada
   const existingFiles = folder.getFilesByName(fileName);
   while (existingFiles.hasNext()) {
     existingFiles.next().setTrashed(true);
   }
   
   // Upload logo baru
   const file = folder.createFile(blob);
   file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
   
   return {
     success: true,
     url: file.getUrl(),
     directUrl: "https://drive.google.com/uc?export=view&id=" + file.getId()
   };
 } catch (err) {
   return { success: false, message: err.message };
 }
}

function saveDraftInvoice(data, currentUser){

  try{

    var ss = getDB();

    var sh = ss.getSheetByName("DRAFT_INVOICE");

    var idDraft = "DRF-" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMddHHmmss");

    var now = new Date();

    sh.appendRow([

      idDraft,                              // id_invoice
      data.tanggal_invoice,                 // tanggal_invoice
      data.tanggal_jatuh_tempo,             // tanggal_jatuh_tempo
      data.nama_pelanggan,                  // nama_pelanggan
      data.alamat_pelanggan,                // alamat_pelanggan
      data.telepon_pelanggan,               // telepon_pelanggan
      data.daftar_item_json,                // daftar_item_json
      data.subtotal,                        // subtotal
      data.diskon,                          // diskon
      data.pajak,                           // pajak
      data.ongkir,                          // ongkir
      data.grand_total,                     // grand_total
      data.metode_pembayaran,               // metode_pembayaran
      data.rekening_tujuan,                 // rekening_tujuan
      "BELUM LUNAS",                        // status_pembayaran
      "DRAFT",                              // status_invoice
      data.catatan_invoice,                 // catatan_invoice
      "",                                   // pdf_url
      currentUser.nama_lengkap,             // dibuat_oleh
      now,                                  // waktu_dibuat
      now                                   // waktu_diubah

    ]);

    return {

      success:true,
      draftId:idDraft

    };

  }catch(err){

    return{

      success:false,
      message:err.toString()

    };

  }

}

function updateDraftInvoice(data, currentUser){
  Logger.log("=== GET DRAFT LIST ===");
  try{

    var ss = getDB();
    var sh = ss.getSheetByName("DRAFT_INVOICE");

    var values = sh.getDataRange().getValues();
    Logger.log("Jumlah Baris : " + values.length);
    Logger.log(values);

    if(values.length<=1){
      return {
        success:false,
        message:"Draft tidak ditemukan."
      };
    }

    var header = values[0];
    var idx = {};

    header.forEach(function(h,i){
      idx[String(h).trim()] = i;
    });

    for(var r=1;r<values.length;r++){

      if(String(values[r][idx.id_invoice])===String(data.id_invoice)){

        sh.getRange(r+1,idx.tanggal_invoice+1).setValue(data.tanggal_invoice);
        sh.getRange(r+1,idx.tanggal_jatuh_tempo+1).setValue(data.tanggal_jatuh_tempo);
        sh.getRange(r+1,idx.nama_pelanggan+1).setValue(data.nama_pelanggan);
        sh.getRange(r+1,idx.alamat_pelanggan+1).setValue(data.alamat_pelanggan);
        sh.getRange(r+1,idx.telepon_pelanggan+1).setValue(data.telepon_pelanggan);
        sh.getRange(r+1,idx.daftar_item_json+1).setValue(data.daftar_item_json);
        sh.getRange(r+1,idx.subtotal+1).setValue(data.subtotal);
        sh.getRange(r+1,idx.diskon+1).setValue(data.diskon);
        sh.getRange(r+1,idx.pajak+1).setValue(data.pajak);
        sh.getRange(r+1,idx.ongkir+1).setValue(data.ongkir);
        sh.getRange(r+1,idx.grand_total+1).setValue(data.grand_total);
        sh.getRange(r+1,idx.metode_pembayaran+1).setValue(data.metode_pembayaran);
        sh.getRange(r+1,idx.rekening_tujuan+1).setValue(data.rekening_tujuan);
        sh.getRange(r+1,idx.catatan_invoice+1).setValue(data.catatan_invoice);
        sh.getRange(r+1,idx.waktu_diubah+1).setValue(new Date());

        return {
          success:true,
          draftId:data.id_invoice
        };

      }

    }

    return{
      success:false,
      message:"Draft tidak ditemukan."
    };

  }catch(err){

    return{
      success:false,
      message:err.toString()
    };

  }

}

function getDraftInvoiceList() {

  try {

    var ss = getDB();
    var sh = ss.getSheetByName("DRAFT_INVOICE");

    if (!sh) {
      throw new Error("Sheet DRAFT_INVOICE tidak ditemukan.");
    }

    var values = sh.getDataRange().getValues();

    if (values.length <= 1) {
      return [];
    }

    var header = values[0];

    var idx = {};

    header.forEach(function(h, i) {
      idx[String(h).trim()] = i;
    });

    var list = [];

    for (var r = 1; r < values.length; r++) {

      list.push({
  id_invoice: String(values[r][idx.id_invoice] || ""),
  tanggal_invoice: Utilities.formatDate(
      new Date(values[r][idx.tanggal_invoice]),
      Session.getScriptTimeZone(),
      "yyyy-MM-dd"
  ),
  nama_pelanggan: String(values[r][idx.nama_pelanggan] || ""),
  grand_total: Number(values[r][idx.grand_total] || 0),
  status_invoice: String(values[r][idx.status_invoice] || "")
});

    }

    list.sort(function(a,b){
      return String(b.id_invoice).localeCompare(String(a.id_invoice));
    });

    Logger.log(JSON.stringify(list));

return list;

  } catch(err) {

    Logger.log(err);
    throw err;

  }

}

function getDraftById(id) {

  var ss = getDB();
  var sh = ss.getSheetByName("DRAFT_INVOICE");

  if (!sh) {
    return {
      success: false,
      message: "Sheet DRAFT_INVOICE tidak ditemukan."
    };
  }

  var values = sh.getDataRange().getValues();

  if (values.length <= 1) {
    return {
      success: false,
      message: "Draft tidak ditemukan."
    };
  }

  var header = values[0];

  var idx = {};
  header.forEach(function(h, i) {
    idx[h] = i;
  });

  for (var r = 1; r < values.length; r++) {

    if (String(values[r][idx.id_invoice]) === String(id)) {

      return {
        success: true,
        data: {

  id_invoice: String(values[r][idx.id_invoice] || ""),

  tanggal_invoice: Utilities.formatDate(
    new Date(values[r][idx.tanggal_invoice]),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd"
  ),

  tanggal_jatuh_tempo: Utilities.formatDate(
    new Date(values[r][idx.tanggal_jatuh_tempo]),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd"
  ),

  nama_pelanggan: String(values[r][idx.nama_pelanggan] || ""),
  alamat_pelanggan: String(values[r][idx.alamat_pelanggan] || ""),
  telepon_pelanggan: String(values[r][idx.telepon_pelanggan] || ""),
  daftar_item_json: String(values[r][idx.daftar_item_json] || ""),

  subtotal: Number(values[r][idx.subtotal] || 0),
  diskon: Number(values[r][idx.diskon] || 0),
  pajak: Number(values[r][idx.pajak] || 0),
  ongkir: Number(values[r][idx.ongkir] || 0),
  grand_total: Number(values[r][idx.grand_total] || 0),

  metode_pembayaran: String(values[r][idx.metode_pembayaran] || ""),
  rekening_tujuan: String(values[r][idx.rekening_tujuan] || ""),
  status_pembayaran: String(values[r][idx.status_pembayaran] || ""),
  status_invoice: String(values[r][idx.status_invoice] || ""),
  catatan_invoice: String(values[r][idx.catatan_invoice] || ""),
  pdf_url: String(values[r][idx.pdf_url] || ""),
  dibuat_oleh: String(values[r][idx.dibuat_oleh] || ""),

  waktu_dibuat: String(values[r][idx.waktu_dibuat] || ""),
  waktu_diubah: String(values[r][idx.waktu_diubah] || "")

}
      };

    }

  }

  return {
    success: false,
    message: "Draft tidak ditemukan."
  };

}

function getInvoiceById(id) {

  var data = getSheetData("LOG_INVOICE");

  for (var i = 0; i < data.length; i++) {

    if (String(data[i].id_invoice) === String(id)) {

      return {
        success: true,
        data: data[i]
      };

    }

  }

  return {
    success: false,
    message: "Invoice tidak ditemukan."
  };

}

function findInvoiceRowById(idInvoice) {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName("LOG_INVOICE");

  if (!sh) {
    throw new Error("Sheet LOG_INVOICE tidak ditemukan.");
  }

  const data = sh.getDataRange().getValues();

  if (data.length < 2) {
    return -1;
  }

  const header = data[0];
  const idCol = header.indexOf("id_invoice");

  if (idCol === -1) {
    throw new Error("Kolom id_invoice tidak ditemukan.");
  }

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(idInvoice)) {
      return i + 1; // Nomor baris Spreadsheet
    }
  }

  return -1;

}

function deleteDraft(id){

  var ss = getDB();

  var sh = ss.getSheetByName("DRAFT_INVOICE");

  if(!sh){

    return {
      success:false,
      message:"Sheet DRAFT_INVOICE tidak ditemukan."
    };

  }

  var values = sh.getDataRange().getValues();

  if(values.length<=1){

    return {
      success:false,
      message:"Draft tidak ditemukan."
    };

  }

  var header = values[0];

  var idx = {};

  header.forEach(function(h,i){

      idx[String(h).trim()] = i;

  });

  for(var r=1;r<values.length;r++){
      if(String(values[r][idx.id_invoice])===String(id)){
          SpreadsheetApp.flush();
            sh.deleteRow(r+1);
          SpreadsheetApp.flush();
          return {
              success:true
          };
      }
  }

  return {

      success:false,

      message:"Draft tidak ditemukan."

  };

}

function getRekeningById(id){

  var list = getRekeningList();

  for(var i=0;i<list.length;i++){

    if(String(list[i].id_rekening)===String(id)){
      return list[i];
    }

  }

  return null;

}

function buildRekeningHtml(idRekening){
  var html = "";

  if(String(idRekening) === "ALL"){
    getRekeningList().forEach(function(r){
      html +=
        "<div style='margin-bottom:8px;line-height:1.5'>" +
        "<b>"+r.nama_bank+"</b><br>" +
        r.nomor_rekening+"<br>" +
        "a.n. "+r.atas_nama+
        "</div>";
    });
  } else {
    var r = getRekeningById(idRekening);
    if(r){
      // Tambahkan margin-bottom:8px agar strukturnya sama persis dengan ALL
      html =
        "<div style='margin-bottom:8px;line-height:1.5'>" +
        "<b>"+r.nama_bank+"</b><br>" +
        r.nomor_rekening+"<br>" +
        "a.n. "+r.atas_nama+
        "</div>";
    }
  }

  // Jika rekening kosong/terhapus, kembalikan teks kosong agar layout tidak error
  return html || "<div style='line-height:1.5'>-</div>";
}

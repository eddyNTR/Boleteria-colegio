/**
 * Sistema de venta de butacas para evento escolar.
 * Backend Google Apps Script — expone una API JSON (el Spreadsheet es la base de datos).
 * El frontend (carpeta /web) se despliega aparte en Vercel y llama a esta API.
 *
 * Hojas usadas:
 *  - Config    : Clave | Valor
 *  - Butacas   : ID | Fila | Numero | Estado | VentaID
 *  - Ventas    : ID | Fecha | NombrePadre | Celular | Butacas | Cantidad | PrecioUnitario | Total | Estado
 */

const SHEET_CONFIG = 'Config';
const SHEET_BUTACAS = 'Butacas';
const SHEET_VENTAS = 'Ventas';

const ESTADO_BUTACA = {
  DISPONIBLE: 'disponible',
  RESERVADA: 'reservada',
  VENDIDA: 'vendida'
};

const ESTADO_VENTA = {
  PENDIENTE: 'pendiente',
  CONFIRMADA: 'confirmada',
  CANCELADA: 'cancelada'
};

// ---------- Enrutador HTTP ----------
// GET  ?action=getDatosIniciales
// POST body JSON: { action: "crearVenta", params: {...} }
// El frontend envía POST con Content-Type: text/plain para evitar el preflight CORS,
// que Apps Script Web Apps no puede responder correctamente.

const ACTIONS = {
  getDatosIniciales: params => getDatosIniciales(),
  crearVenta: params => crearVenta(params.nombrePadre, params.celular, params.butacasIds),
  adminLogin: params => adminLogin(params.password),
  adminGetVentas: params => adminGetVentas(params.password),
  adminConfirmarVenta: params => adminConfirmarVenta(params.password, params.ventaId),
  adminCancelarVenta: params => adminCancelarVenta(params.password, params.ventaId),
  adminActualizarQRPago: params => adminActualizarQRPago(params.password, params.imagenBase64, params.mimeType, params.infoTexto)
};

function doGet(e) {
  const action = (e.parameter && e.parameter.action) || 'getDatosIniciales';
  return ejecutarAccion_(action, e.parameter || {});
}

function doPost(e) {
  let body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse_({ ok: false, error: 'Cuerpo de solicitud inválido.' });
  }
  return ejecutarAccion_(body.action, body.params || {});
}

function ejecutarAccion_(action, params) {
  const fn = ACTIONS[action];
  if (!fn) return jsonResponse_({ ok: false, error: 'Acción desconocida: ' + action });
  try {
    const data = fn(params);
    return jsonResponse_({ ok: true, data: data });
  } catch (err) {
    return jsonResponse_({ ok: false, error: err.message });
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- Utilidades de hoja ----------

function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('No existe la hoja: ' + name);
  return sheet;
}

function sheetToObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  return values
    .filter(row => row.some(cell => cell !== '' && cell !== null))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = row[i]);
      return obj;
    });
}

function getConfigValue_(clave) {
  const sheet = getSheet_(SHEET_CONFIG);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === clave) return data[i][1];
  }
  return null;
}

function setConfigValue_(clave, valor) {
  const sheet = getSheet_(SHEET_CONFIG);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === clave) {
      sheet.getRange(i + 1, 2).setValue(valor);
      return;
    }
  }
  sheet.appendRow([clave, valor]);
}

// ---------- Configuración inicial (ejecutar una vez desde el editor de Apps Script) ----------

function setupInicial() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let config = ss.getSheetByName(SHEET_CONFIG);
  if (!config) config = ss.insertSheet(SHEET_CONFIG);
  if (config.getLastRow() === 0) {
    config.appendRow(['Clave', 'Valor']);
    config.appendRow(['NombreEvento', 'Evento Escolar']);
    config.appendRow(['PrecioButaca', 20]);
    config.appendRow(['Filas', 8]);
    config.appendRow(['ButacasPorFila', 10]);
    config.appendRow(['AdminPassword', 'cambiar-esta-clave']);
    config.appendRow(['QRPagoURL', '']);
    config.appendRow(['QRPagoInfo', 'Yape / Plin al número del colegio']);
  }

  let butacas = ss.getSheetByName(SHEET_BUTACAS);
  if (!butacas) butacas = ss.insertSheet(SHEET_BUTACAS);
  if (butacas.getLastRow() === 0) {
    butacas.appendRow(['ID', 'Fila', 'Numero', 'Estado', 'VentaID']);
    regenerarButacas_();
  }

  let ventas = ss.getSheetByName(SHEET_VENTAS);
  if (!ventas) ventas = ss.insertSheet(SHEET_VENTAS);
  if (ventas.getLastRow() === 0) {
    ventas.appendRow(['ID', 'Fecha', 'NombrePadre', 'Celular', 'Butacas', 'Cantidad', 'PrecioUnitario', 'Total', 'Estado']);
  }

  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert('Listo. Hojas Config, Butacas y Ventas inicializadas.');
}

// Regenera el mapa de butacas según Filas x ButacasPorFila de Config.
// Borra cualquier venta existente sobre esas butacas, úsese solo en la configuración inicial.
function regenerarButacas_() {
  const filas = Number(getConfigValue_('Filas')) || 8;
  const porFila = Number(getConfigValue_('ButacasPorFila')) || 10;
  const sheet = getSheet_(SHEET_BUTACAS);
  const filasExistentes = sheet.getLastRow() - 1;
  if (filasExistentes > 0) {
    sheet.getRange(2, 1, filasExistentes, 5).clearContent();
  }

  const rows = [];
  for (let f = 0; f < filas; f++) {
    const letra = String.fromCharCode(65 + f); // A, B, C...
    for (let n = 1; n <= porFila; n++) {
      rows.push([letra + n, letra, n, ESTADO_BUTACA.DISPONIBLE, '']);
    }
  }
  sheet.getRange(2, 1, rows.length, 5).setValues(rows);
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Boletería')
    .addItem('Inicializar / Configurar', 'setupInicial')
    .addItem('Ver URL de la API', 'mostrarUrlApp')
    .addToUi();
}

function mostrarUrlApp() {
  const url = ScriptApp.getService().getUrl();
  SpreadsheetApp.getUi().alert(url || 'Aún no se ha desplegado como Web App. Implementar > Nueva implementación > Aplicación web.');
}

// ---------- API pública ----------

function getDatosIniciales() {
  const butacas = sheetToObjects_(getSheet_(SHEET_BUTACAS)).map(b => ({
    id: b.ID, fila: b.Fila, numero: b.Numero, estado: b.Estado
  }));
  return {
    nombreEvento: getConfigValue_('NombreEvento'),
    precioButaca: Number(getConfigValue_('PrecioButaca')) || 0,
    filas: Number(getConfigValue_('Filas')) || 0,
    butacasPorFila: Number(getConfigValue_('ButacasPorFila')) || 0,
    qrPagoURL: getConfigValue_('QRPagoURL') || '',
    qrPagoInfo: getConfigValue_('QRPagoInfo') || '',
    butacas: butacas
  };
}

// Crea una venta en estado "pendiente" y reserva las butacas seleccionadas.
// Usa LockService para evitar que dos padres compren la misma butaca a la vez.
function crearVenta(nombrePadre, celular, butacasIds) {
  nombrePadre = String(nombrePadre || '').trim();
  celular = String(celular || '').trim();
  if (!nombrePadre) throw new Error('Falta el nombre del padre/madre.');
  if (!/^[0-9+ ]{6,15}$/.test(celular)) throw new Error('Número de celular inválido.');
  if (!Array.isArray(butacasIds) || butacasIds.length === 0) throw new Error('Selecciona al menos una butaca.');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = getSheet_(SHEET_BUTACAS);
    const data = sheet.getDataRange().getValues();
    const idxById = {};
    for (let i = 1; i < data.length; i++) idxById[data[i][0]] = i;

    for (const id of butacasIds) {
      const row = idxById[id];
      if (row === undefined) throw new Error('Butaca inexistente: ' + id);
      if (data[row][3] !== ESTADO_BUTACA.DISPONIBLE) {
        throw new Error('La butaca ' + id + ' ya no está disponible. Actualiza la página e intenta de nuevo.');
      }
    }

    const precio = Number(getConfigValue_('PrecioButaca')) || 0;
    const ventaId = Utilities.getUuid().split('-')[0].toUpperCase();
    const total = precio * butacasIds.length;

    const ventasSheet = getSheet_(SHEET_VENTAS);
    ventasSheet.appendRow([
      ventaId, new Date(), nombrePadre, celular,
      butacasIds.join(', '), butacasIds.length, precio, total, ESTADO_VENTA.PENDIENTE
    ]);

    for (const id of butacasIds) {
      const row = idxById[id];
      sheet.getRange(row + 1, 4).setValue(ESTADO_BUTACA.RESERVADA);
      sheet.getRange(row + 1, 5).setValue(ventaId);
    }

    return {
      ventaId: ventaId,
      total: total,
      nombreEvento: getConfigValue_('NombreEvento'),
      butacas: butacasIds
    };
  } finally {
    lock.releaseLock();
  }
}

// ---------- Panel admin ----------

function verificarAdmin_(password) {
  const real = getConfigValue_('AdminPassword');
  if (!password || password !== real) throw new Error('Clave de administrador incorrecta.');
}

function adminLogin(password) {
  verificarAdmin_(password);
  return true;
}

function adminGetVentas(password) {
  verificarAdmin_(password);
  return sheetToObjects_(getSheet_(SHEET_VENTAS)).sort((a, b) => new Date(b.Fecha) - new Date(a.Fecha));
}

function adminConfirmarVenta(password, ventaId) {
  verificarAdmin_(password);
  cambiarEstadoVenta_(ventaId, ESTADO_VENTA.CONFIRMADA, ESTADO_BUTACA.VENDIDA);
  return true;
}

function adminCancelarVenta(password, ventaId) {
  verificarAdmin_(password);
  cambiarEstadoVenta_(ventaId, ESTADO_VENTA.CANCELADA, ESTADO_BUTACA.DISPONIBLE);
  return true;
}

function cambiarEstadoVenta_(ventaId, nuevoEstadoVenta, nuevoEstadoButaca) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ventasSheet = getSheet_(SHEET_VENTAS);
    const vData = ventasSheet.getDataRange().getValues();
    let ventaRow = -1;
    for (let i = 1; i < vData.length; i++) {
      if (vData[i][0] === ventaId) { ventaRow = i; break; }
    }
    if (ventaRow === -1) throw new Error('Venta no encontrada: ' + ventaId);
    ventasSheet.getRange(ventaRow + 1, 9).setValue(nuevoEstadoVenta);

    const butacasSheet = getSheet_(SHEET_BUTACAS);
    const bData = butacasSheet.getDataRange().getValues();
    for (let i = 1; i < bData.length; i++) {
      if (bData[i][4] === ventaId) {
        butacasSheet.getRange(i + 1, 4).setValue(nuevoEstadoButaca);
        if (nuevoEstadoButaca === ESTADO_BUTACA.DISPONIBLE) {
          butacasSheet.getRange(i + 1, 5).setValue('');
        }
      }
    }
  } finally {
    lock.releaseLock();
  }
}

// Actualiza el QR de pago (imagen estática, ej. Yape/Plin). Solo admin.
// imagenBase64 viene sin el prefijo "data:image/...;base64,"
function adminActualizarQRPago(password, imagenBase64, mimeType, infoTexto) {
  verificarAdmin_(password);
  if (!imagenBase64) throw new Error('No se recibió ninguna imagen.');

  const folder = obtenerCarpetaQR_();
  const blob = Utilities.newBlob(Utilities.base64Decode(imagenBase64), mimeType, 'qr-pago');

  // Elimina el QR anterior si existe, para no acumular archivos.
  const anteriorId = getConfigValue_('QRPagoFileId');
  if (anteriorId) {
    try { DriveApp.getFileById(anteriorId).setTrashed(true); } catch (err) { /* ya no existe, ignorar */ }
  }

  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const url = 'https://drive.google.com/uc?export=view&id=' + file.getId();
  setConfigValue_('QRPagoURL', url);
  setConfigValue_('QRPagoFileId', file.getId());
  if (infoTexto !== undefined && infoTexto !== null) {
    setConfigValue_('QRPagoInfo', infoTexto);
  }
  return url;
}

function obtenerCarpetaQR_() {
  const nombre = 'Boleteria_QR_Pago';
  const it = DriveApp.getFoldersByName(nombre);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(nombre);
}

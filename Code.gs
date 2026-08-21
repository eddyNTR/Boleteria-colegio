/**
 * Sistema de venta de butacas para evento escolar.
 * Backend Google Apps Script — expone una API JSON (el Spreadsheet es la base de datos).
 * El frontend (carpeta /web) se despliega aparte en Vercel y llama a esta API.
 *
 * Soporta varias "funciones" (ej. Miércoles 3 / Jueves 4) con mapas de butacas
 * y ventas independientes entre sí, sobre la misma estructura de sala.
 *
 * Hojas usadas:
 *  - Config    : Clave | Valor
 *  - Funciones : ID | Nombre | Fecha
 *  - Butacas   : ID | FuncionID | Fila | Numero | Estado | VentaID
 *  - Ventas    : ID | FuncionID | Fecha | NombrePadre | Celular | Butacas | Cantidad | PrecioUnitario | Total | Estado | ComprobanteURL | MetodoPago
 */

const SHEET_CONFIG = 'Config';
const SHEET_FUNCIONES = 'Funciones';
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

const METODO_PAGO = {
  QR: 'qr',
  EFECTIVO: 'efectivo'
};

// ---------- Enrutador HTTP ----------
// GET  ?action=getDatosIniciales[&funcionId=MIE]
// POST body JSON: { action: "crearVenta", params: {...} }
// El frontend envía POST con Content-Type: text/plain para evitar el preflight CORS,
// que Apps Script Web Apps no puede responder correctamente.

const ACTIONS = {
  getDatosIniciales: params => getDatosIniciales(params.funcionId),
  crearVenta: params => crearVenta(params.funcionId, params.nombrePadre, params.celular, params.asientos, params.metodoPago, params.imagenBase64, params.mimeType),
  adminLogin: params => adminLogin(params.password),
  adminGetVentas: params => adminGetVentas(params.password),
  adminConfirmarVenta: params => adminConfirmarVenta(params.password, params.ventaId),
  adminCancelarVenta: params => adminCancelarVenta(params.password, params.ventaId),
  adminActualizarQRPago: params => adminActualizarQRPago(params.password, params.imagenBase64, params.mimeType, params.infoTexto),
  adminActualizarFuncion: params => adminActualizarFuncion(params.password, params.funcionId, params.nombre),
  adminObtenerSheetUrl: params => adminObtenerSheetUrl(params.password)
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

// Cachea la hoja Config en memoria durante la ejecución actual (cada request a la Web App
// es una ejecución nueva, así que esto no queda "viejo" entre usuarios). Sin esto,
// getDatosIniciales terminaba leyendo la hoja Config completa 7 veces por carga.
let configCache_ = null;

function getConfigMap_() {
  if (!configCache_) {
    const data = getSheet_(SHEET_CONFIG).getDataRange().getValues();
    configCache_ = {};
    for (let i = 1; i < data.length; i++) configCache_[data[i][0]] = data[i][1];
  }
  return configCache_;
}

function getConfigValue_(clave) {
  const map = getConfigMap_();
  return Object.prototype.hasOwnProperty.call(map, clave) ? map[clave] : null;
}

function setConfigValue_(clave, valor) {
  const sheet = getSheet_(SHEET_CONFIG);
  const data = sheet.getDataRange().getValues();
  let escrito = false;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === clave) {
      sheet.getRange(i + 1, 2).setValue(valor);
      escrito = true;
      break;
    }
  }
  if (!escrito) sheet.appendRow([clave, valor]);
  if (configCache_) configCache_[clave] = valor;
}

let funcionesCache_ = null;

function getFunciones_() {
  if (!funcionesCache_) {
    funcionesCache_ = sheetToObjects_(getSheet_(SHEET_FUNCIONES)).map(f => ({ id: f.ID, nombre: f.Nombre, fecha: f.Fecha }));
  }
  return funcionesCache_;
}

// ---------- Configuración inicial (ejecutar una vez desde el editor de Apps Script) ----------
// Sala: filas A-P (16 filas), 19 butacas por fila, numeración continua 1-19,
// con el pasillo central entre la butaca 9 y la 10 (solo visual en el frontend).

function setupInicial() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let config = ss.getSheetByName(SHEET_CONFIG);
  if (!config) config = ss.insertSheet(SHEET_CONFIG);
  if (config.getLastRow() === 0) {
    config.appendRow(['Clave', 'Valor']);
    config.appendRow(['NombreEvento', 'Evento Escolar']);
    config.appendRow(['PrecioButaca', 20]);
    config.appendRow(['Filas', 16]);
    config.appendRow(['ButacasPorFila', 19]);
    config.appendRow(['PasilloTrasNumero', 9]);
    config.appendRow(['AdminPassword', 'cambiar-esta-clave']);
    config.appendRow(['QRPagoURL', '']);
    config.appendRow(['QRPagoInfo', 'Escanea para pagar']);
  }

  let funciones = ss.getSheetByName(SHEET_FUNCIONES);
  if (!funciones) funciones = ss.insertSheet(SHEET_FUNCIONES);
  if (funciones.getLastRow() === 0) {
    funciones.appendRow(['ID', 'Nombre', 'Fecha']);
    funciones.appendRow(['MIE', 'Miércoles 3', '']);
    funciones.appendRow(['JUE', 'Jueves 4', '']);
  }

  let butacas = ss.getSheetByName(SHEET_BUTACAS);
  if (!butacas) butacas = ss.insertSheet(SHEET_BUTACAS);
  if (butacas.getLastRow() === 0) {
    butacas.appendRow(['ID', 'FuncionID', 'Fila', 'Numero', 'Estado', 'VentaID']);
  }
  if (butacas.getLastRow() <= 1) {
    regenerarButacas_();
  }

  let ventas = ss.getSheetByName(SHEET_VENTAS);
  if (!ventas) ventas = ss.insertSheet(SHEET_VENTAS);
  if (ventas.getLastRow() === 0) {
    ventas.appendRow(['ID', 'FuncionID', 'Fecha', 'NombrePadre', 'Celular', 'Butacas', 'Cantidad', 'PrecioUnitario', 'Total', 'Estado', 'ComprobanteURL', 'MetodoPago']);
  }

  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert('Listo. Hojas Config, Funciones, Butacas y Ventas inicializadas.');
}

// Regenera el mapa de butacas de TODAS las funciones según Filas x ButacasPorFila de Config.
// Borra cualquier venta existente sobre esas butacas — úsese solo en la configuración inicial
// o si de verdad quieres reiniciar el mapa (perderás el estado de ventas ya registradas).
function regenerarButacas_() {
  const filas = Number(getConfigValue_('Filas')) || 16;
  const porFila = Number(getConfigValue_('ButacasPorFila')) || 19;
  const funciones = getFunciones_();
  const sheet = getSheet_(SHEET_BUTACAS);

  const filasExistentes = sheet.getLastRow() - 1;
  if (filasExistentes > 0) {
    sheet.getRange(2, 1, filasExistentes, 6).clearContent();
  }

  const rows = [];
  funciones.forEach(fn => {
    for (let f = 0; f < filas; f++) {
      const letra = String.fromCharCode(65 + f); // A, B, C...
      for (let n = 1; n <= porFila; n++) {
        const id = fn.id + '-' + letra + n;
        rows.push([id, fn.id, letra, n, ESTADO_BUTACA.DISPONIBLE, '']);
      }
    }
  });
  sheet.getRange(2, 1, rows.length, 6).setValues(rows);
}

// Función pública para poder ejecutarla desde el desplegable del editor
// (Apps Script no lista ahí las funciones que terminan en "_").
function regenerarButacasManual() {
  regenerarButacas_();
  SpreadsheetApp.getUi().alert('Butacas regeneradas correctamente.');
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

function getDatosIniciales(funcionId) {
  const funciones = getFunciones_();
  if (funciones.length === 0) throw new Error('No hay funciones configuradas.');
  const funcionActual = funciones.find(f => f.id === funcionId) || funciones[0];

  const butacas = sheetToObjects_(getSheet_(SHEET_BUTACAS))
    .filter(b => b.FuncionID === funcionActual.id)
    .map(b => ({ id: b.ID, codigo: b.Fila + b.Numero, fila: b.Fila, numero: b.Numero, estado: b.Estado }));

  return {
    nombreEvento: getConfigValue_('NombreEvento'),
    precioButaca: Number(getConfigValue_('PrecioButaca')) || 0,
    filas: Number(getConfigValue_('Filas')) || 0,
    butacasPorFila: Number(getConfigValue_('ButacasPorFila')) || 0,
    pasilloTrasNumero: Number(getConfigValue_('PasilloTrasNumero')) || 0,
    qrPagoURL: getConfigValue_('QRPagoURL') || '',
    qrPagoInfo: getConfigValue_('QRPagoInfo') || '',
    funciones: funciones,
    funcionActual: funcionActual.id,
    butacas: butacas
  };
}

// Crea la venta y reserva las butacas SOLO si ya viene con el comprobante de pago adjunto.
// Así, si el padre cierra o refresca la página antes de terminar el formulario completo
// (asientos + datos + comprobante), no queda ninguna butaca bloqueada — nunca se llegó
// a enviar nada al servidor. No hace falta expirar reservas ni recuperarlas.
// Usa LockService para evitar que dos padres compren la misma butaca a la vez.
// "asientos" son códigos simples como "A1" (sin el prefijo de la función).
function crearVenta(funcionId, nombrePadre, celular, asientos, metodoPago, imagenBase64, mimeType) {
  nombrePadre = String(nombrePadre || '').trim();
  celular = String(celular || '').trim();
  if (!funcionId) throw new Error('Falta indicar la función (día).');
  if (!getFunciones_().some(f => f.id === funcionId)) throw new Error('Función inválida.');
  if (!nombrePadre) throw new Error('Falta el nombre del padre/madre.');
  if (!/^[0-9+ ]{6,15}$/.test(celular)) throw new Error('Número de celular inválido.');
  if (!Array.isArray(asientos) || asientos.length === 0) throw new Error('Selecciona al menos una butaca.');
  if (metodoPago !== METODO_PAGO.QR && metodoPago !== METODO_PAGO.EFECTIVO) throw new Error('Método de pago inválido.');
  if (metodoPago === METODO_PAGO.QR && !imagenBase64) throw new Error('Falta el comprobante de pago.');

  const butacasIds = asientos.map(codigo => funcionId + '-' + codigo);

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
      if (data[row][4] !== ESTADO_BUTACA.DISPONIBLE) {
        throw new Error('La butaca ' + id + ' ya no está disponible. Actualiza la página e intenta de nuevo.');
      }
    }

    const precio = Number(getConfigValue_('PrecioButaca')) || 0;
    const ventaId = Utilities.getUuid().split('-')[0].toUpperCase();
    const total = precio * asientos.length;

    let comprobanteUrl = '';
    if (metodoPago === METODO_PAGO.QR) {
      const folder = obtenerCarpetaComprobantes_();
      const blob = Utilities.newBlob(Utilities.base64Decode(imagenBase64), mimeType, 'comprobante-' + ventaId);
      const file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      comprobanteUrl = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1000';
    }

    const ventasSheet = getSheet_(SHEET_VENTAS);
    ventasSheet.appendRow([
      ventaId, funcionId, new Date(), nombrePadre, celular,
      asientos.join(', '), asientos.length, precio, total, ESTADO_VENTA.PENDIENTE, comprobanteUrl, metodoPago
    ]);

    for (const id of butacasIds) {
      const row = idxById[id];
      sheet.getRange(row + 1, 5).setValue(ESTADO_BUTACA.RESERVADA);
      sheet.getRange(row + 1, 6).setValue(ventaId);
    }

    const funcion = getFunciones_().find(f => f.id === funcionId);
    return {
      ventaId: ventaId,
      total: total,
      nombreEvento: getConfigValue_('NombreEvento'),
      funcionNombre: funcion ? funcion.nombre : funcionId,
      asientos: asientos,
      nombrePadre: nombrePadre,
      celular: celular
    };
  } finally {
    lock.releaseLock();
  }
}

function obtenerCarpetaComprobantes_() {
  const nombre = 'Boleteria_Comprobantes_Pago';
  const it = DriveApp.getFoldersByName(nombre);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(nombre);
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

function adminObtenerSheetUrl(password) {
  verificarAdmin_(password);
  return SpreadsheetApp.getActiveSpreadsheet().getUrl();
}

function adminGetVentas(password) {
  verificarAdmin_(password);
  const funcionesPorId = {};
  getFunciones_().forEach(f => funcionesPorId[f.id] = f.nombre);
  return sheetToObjects_(getSheet_(SHEET_VENTAS))
    .map(v => Object.assign({}, v, { FuncionNombre: funcionesPorId[v.FuncionID] || v.FuncionID }))
    .sort((a, b) => new Date(b.Fecha) - new Date(a.Fecha));
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
    ventasSheet.getRange(ventaRow + 1, 10).setValue(nuevoEstadoVenta); // columna Estado

    const butacasSheet = getSheet_(SHEET_BUTACAS);
    const bData = butacasSheet.getDataRange().getValues();
    for (let i = 1; i < bData.length; i++) {
      if (bData[i][5] === ventaId) { // columna VentaID
        butacasSheet.getRange(i + 1, 5).setValue(nuevoEstadoButaca); // columna Estado
        if (nuevoEstadoButaca === ESTADO_BUTACA.DISPONIBLE) {
          butacasSheet.getRange(i + 1, 6).setValue(''); // columna VentaID
        }
      }
    }
  } finally {
    lock.releaseLock();
  }
}

// Actualiza el QR de pago (imagen estática). Solo admin. Se comparte entre todas las funciones.
// imagenBase64 viene sin el prefijo "data:image/...;base64,"
// Renombra una función (ej. "Miércoles 3" -> "Sábado 10") desde el panel admin,
// sin tener que editar la hoja Funciones a mano.
function adminActualizarFuncion(password, funcionId, nombre) {
  verificarAdmin_(password);
  nombre = String(nombre || '').trim();
  if (!funcionId) throw new Error('Falta indicar la función.');
  if (!nombre) throw new Error('El nombre no puede estar vacío.');

  const sheet = getSheet_(SHEET_FUNCIONES);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === funcionId) {
      sheet.getRange(i + 1, 2).setValue(nombre);
      funcionesCache_ = null;
      return true;
    }
  }
  throw new Error('Función no encontrada: ' + funcionId);
}

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

  const url = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1000';
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

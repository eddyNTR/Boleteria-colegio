// ---------- Estado ----------
let datosEvento = null;
let seleccionadas = new Set();
let adminPassword = null;

// ---------- Utilidad de llamada a la API (Apps Script) ----------
async function llamarApi(action, params) {
  if (!params) {
    const url = new URL(APPS_SCRIPT_URL);
    url.searchParams.set('action', action);
    const res = await fetch(url.toString());
    return leerRespuesta_(res);
  }
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    // text/plain evita el preflight CORS que Apps Script no puede responder.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, params })
  });
  return leerRespuesta_(res);
}

async function leerRespuesta_(res) {
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error desconocido.');
  return json.data;
}

function mostrarMsg(el, texto, tipo) {
  el.textContent = texto;
  el.className = 'msg ' + tipo;
  el.hidden = false;
}

function ocultarMsg(el) {
  el.hidden = true;
}

// ---------- Tabs ----------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

document.querySelectorAll('.subtab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.subtab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('subtab-' + btn.dataset.subtab).classList.add('active');
    if (btn.dataset.subtab === 'ventas') cargarVentas();
  });
});

// ---------- Mapa de butacas ----------
async function cargarMapa() {
  const seatMap = document.getElementById('seatMap');
  const msg = document.getElementById('msgComprar');
  try {
    datosEvento = await llamarApi('getDatosIniciales');
    document.getElementById('nombreEvento').textContent = datosEvento.nombreEvento || 'Venta de Butacas';
    document.title = datosEvento.nombreEvento || 'Venta de Butacas';
    renderMapa();
    ocultarMsg(msg);
  } catch (err) {
    mostrarMsg(msg, 'No se pudo cargar el mapa de butacas: ' + err.message, 'error');
    seatMap.textContent = '';
  }
}

function renderMapa() {
  const seatMap = document.getElementById('seatMap');
  seatMap.innerHTML = '';

  const porFila = {};
  datosEvento.butacas.forEach(b => {
    if (!porFila[b.fila]) porFila[b.fila] = [];
    porFila[b.fila].push(b);
  });

  Object.keys(porFila).sort().forEach(fila => {
    const row = document.createElement('div');
    row.className = 'seat-row';

    const label = document.createElement('div');
    label.className = 'seat-row-label';
    label.textContent = fila;
    row.appendChild(label);

    porFila[fila].sort((a, b) => a.numero - b.numero).forEach(b => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'seat ' + estadoClase(b);
      btn.textContent = b.numero;
      btn.title = b.id;
      if (b.estado !== 'disponible') btn.disabled = true;
      btn.addEventListener('click', () => toggleButaca(b.id, btn));
      row.appendChild(btn);
    });

    seatMap.appendChild(row);
  });

  actualizarResumen();
}

function estadoClase(b) {
  if (seleccionadas.has(b.id)) return 'seleccionada';
  return b.estado;
}

function toggleButaca(id, btn) {
  if (seleccionadas.has(id)) {
    seleccionadas.delete(id);
    btn.classList.remove('seleccionada');
  } else {
    seleccionadas.add(id);
    btn.classList.add('seleccionada');
  }
  actualizarResumen();
}

function actualizarResumen() {
  document.getElementById('cantidadSeleccionada').textContent = seleccionadas.size;
  const total = seleccionadas.size * (datosEvento ? datosEvento.precioButaca : 0);
  document.getElementById('totalSeleccionado').textContent = total;
}

document.getElementById('btnRefrescar').addEventListener('click', cargarMapa);

// ---------- Formulario de compra ----------
document.getElementById('formCompra').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('msgComprar');
  ocultarMsg(msg);

  if (seleccionadas.size === 0) {
    mostrarMsg(msg, 'Selecciona al menos una butaca en el mapa.', 'error');
    return;
  }

  const nombrePadre = document.getElementById('nombrePadre').value.trim();
  const celularPadre = document.getElementById('celularPadre').value.trim();
  const boton = e.target.querySelector('button[type="submit"]');
  boton.disabled = true;
  boton.textContent = 'Procesando…';

  try {
    const venta = await llamarApi('crearVenta', {
      nombrePadre, celular: celularPadre, butacasIds: Array.from(seleccionadas)
    });
    mostrarResultadoCompra(venta);
    seleccionadas.clear();
    e.target.reset();
    await cargarMapa();
  } catch (err) {
    mostrarMsg(msg, err.message, 'error');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Reservar butacas seleccionadas';
  }
});

async function mostrarResultadoCompra(venta) {
  const cont = document.getElementById('resultadoCompra');
  cont.hidden = false;
  cont.innerHTML = `
    <h2>¡Reserva registrada!</h2>
    <p>Código de venta: <strong>${venta.ventaId}</strong></p>
    <p>Butacas: <strong>${venta.butacas.join(', ')}</strong></p>
    <p>Total a pagar: <strong>S/ ${venta.total}</strong></p>
    <p>Escanea el QR de pago (${datosEvento.qrPagoInfo || 'ver con administración'}) y luego guarda este comprobante:</p>
    ${datosEvento.qrPagoURL ? `<img class="qr-img" src="${datosEvento.qrPagoURL}" alt="QR de pago">` : '<p><em>El colegio aún no configuró el QR de pago.</em></p>'}
    <canvas id="canvasComprobante"></canvas>
    <p><small>Tu butaca queda <strong>reservada</strong> hasta que el colegio confirme tu pago.</small></p>
  `;
  cont.scrollIntoView({ behavior: 'smooth' });

  const texto = `VENTA:${venta.ventaId}|EVENTO:${venta.nombreEvento}|BUTACAS:${venta.butacas.join(',')}|TOTAL:${venta.total}`;
  const canvas = document.getElementById('canvasComprobante');
  await QRCode.toCanvas(canvas, texto, { width: 200 });
}

// ---------- Admin: login ----------
document.getElementById('btnLoginAdmin').addEventListener('click', async () => {
  const clave = document.getElementById('claveAdmin').value;
  const msg = document.getElementById('msgLoginAdmin');
  try {
    await llamarApi('adminLogin', { password: clave });
    adminPassword = clave;
    document.getElementById('loginAdmin').hidden = true;
    document.getElementById('panelAdmin').hidden = false;
    await cargarVentas();
    await cargarQRActual();
  } catch (err) {
    mostrarMsg(msg, err.message, 'error');
  }
});

// ---------- Admin: ventas ----------
document.getElementById('btnRefrescarVentas').addEventListener('click', cargarVentas);
document.getElementById('btnExportarSheet').addEventListener('click', () => {
  alert('Abre directamente el Google Sheet vinculado al proyecto de Apps Script (hoja "Ventas") para ver el historial completo.');
});

async function cargarVentas() {
  const msg = document.getElementById('msgVentas');
  const tbody = document.querySelector('#tablaVentas tbody');
  try {
    const ventas = await llamarApi('adminGetVentas', { password: adminPassword });
    tbody.innerHTML = '';
    ventas.forEach(v => {
      const tr = document.createElement('tr');
      const fecha = new Date(v.Fecha);
      tr.innerHTML = `
        <td>${v.ID}</td>
        <td>${isNaN(fecha) ? v.Fecha : fecha.toLocaleString()}</td>
        <td>${v.NombrePadre}</td>
        <td>${v.Celular}</td>
        <td>${v.Butacas}</td>
        <td>S/ ${v.Total}</td>
        <td><span class="estado-pill ${v.Estado}">${v.Estado}</span></td>
        <td></td>
      `;
      const tdAcciones = tr.querySelector('td:last-child');
      if (v.Estado === 'pendiente') {
        const btnOk = document.createElement('button');
        btnOk.textContent = 'Confirmar';
        btnOk.className = 'accion-btn confirmar';
        btnOk.addEventListener('click', () => accionVenta(v.ID, 'adminConfirmarVenta'));
        const btnNo = document.createElement('button');
        btnNo.textContent = 'Cancelar';
        btnNo.className = 'accion-btn cancelar';
        btnNo.addEventListener('click', () => accionVenta(v.ID, 'adminCancelarVenta'));
        tdAcciones.append(btnOk, btnNo);
      }
      tbody.appendChild(tr);
    });
    ocultarMsg(msg);
  } catch (err) {
    mostrarMsg(msg, err.message, 'error');
  }
}

async function accionVenta(ventaId, accion) {
  const msg = document.getElementById('msgVentas');
  try {
    await llamarApi(accion, { password: adminPassword, ventaId });
    await cargarVentas();
  } catch (err) {
    mostrarMsg(msg, err.message, 'error');
  }
}

// ---------- Admin: QR de pago ----------
async function cargarQRActual() {
  document.getElementById('qrPagoPreview').src = datosEvento.qrPagoURL || '';
  document.getElementById('infoQR').value = datosEvento.qrPagoInfo || '';
}

document.getElementById('btnGuardarQR').addEventListener('click', async () => {
  const msg = document.getElementById('msgQR');
  const input = document.getElementById('inputQR');
  const infoTexto = document.getElementById('infoQR').value.trim();
  ocultarMsg(msg);

  if (!input.files || input.files.length === 0) {
    mostrarMsg(msg, 'Selecciona una imagen de QR.', 'error');
    return;
  }
  const file = input.files[0];
  const base64 = await archivoABase64(file);

  try {
    const url = await llamarApi('adminActualizarQRPago', {
      password: adminPassword, imagenBase64: base64, mimeType: file.type, infoTexto
    });
    document.getElementById('qrPagoPreview').src = url;
    if (datosEvento) { datosEvento.qrPagoURL = url; datosEvento.qrPagoInfo = infoTexto; }
    mostrarMsg(msg, 'QR de pago actualizado correctamente.', 'ok');
    input.value = '';
  } catch (err) {
    mostrarMsg(msg, err.message, 'error');
  }
});

function archivoABase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- Modal ----------
document.getElementById('cerrarModal').addEventListener('click', () => {
  document.getElementById('modalTicket').hidden = true;
});

// ---------- Inicio ----------
cargarMapa();

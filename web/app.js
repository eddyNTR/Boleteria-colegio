// ---------- Estado ----------
let datosEvento = null;
let funcionActual = null;
let seleccionadas = new Set(); // códigos de butaca, ej. "A1" (sin prefijo de función)
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

// ---------- Selector de función (día) ----------
document.getElementById('selectFuncion').addEventListener('change', (e) => {
  seleccionadas.clear();
  cargarMapa(e.target.value);
});

function poblarSelectorFunciones() {
  const select = document.getElementById('selectFuncion');
  select.innerHTML = '';
  datosEvento.funciones.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.nombre;
    if (f.id === datosEvento.funcionActual) opt.selected = true;
    select.appendChild(opt);
  });
}

// ---------- Mapa de butacas ----------
async function cargarMapa(funcionId) {
  const seatMap = document.getElementById('seatMap');
  const msg = document.getElementById('msgComprar');
  try {
    datosEvento = await llamarApi('getDatosIniciales', funcionId ? { funcionId } : undefined);
    funcionActual = datosEvento.funcionActual;
    document.getElementById('nombreEvento').textContent = datosEvento.nombreEvento || 'Venta de Butacas';
    document.title = datosEvento.nombreEvento || 'Venta de Butacas';
    poblarSelectorFunciones();
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

  const butacasPorFila = datosEvento.butacasPorFila || 0;
  const pasilloTrasNumero = datosEvento.pasilloTrasNumero || 0;

  // Columnas: etiqueta de fila + una columna por asiento + una columna angosta
  // para el pasillo (si corresponde) — todas reparten el ancho disponible (1fr),
  // así el mapa entra completo sin necesitar scroll horizontal.
  const columnas = ['minmax(16px, 22px)'];
  for (let n = 1; n <= butacasPorFila; n++) {
    columnas.push('1fr');
    if (pasilloTrasNumero && n === pasilloTrasNumero) columnas.push('minmax(6px, 12px)');
  }
  seatMap.style.gridTemplateColumns = columnas.join(' ');

  Object.keys(porFila).sort().forEach(fila => {
    const label = document.createElement('div');
    label.className = 'seat-row-label';
    label.textContent = fila;
    seatMap.appendChild(label);

    porFila[fila].sort((a, b) => a.numero - b.numero).forEach(b => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'seat ' + estadoClase(b);
      btn.textContent = b.numero;
      btn.title = b.codigo;
      if (b.estado !== 'disponible') btn.disabled = true;
      btn.addEventListener('click', () => toggleButaca(b.codigo, btn));
      seatMap.appendChild(btn);

      if (pasilloTrasNumero && Number(b.numero) === pasilloTrasNumero) {
        const gap = document.createElement('div');
        gap.className = 'seat-gap';
        seatMap.appendChild(gap);
      }
    });
  });

  actualizarResumen();
}

function estadoClase(b) {
  if (seleccionadas.has(b.codigo)) return 'seleccionada';
  return b.estado;
}

function toggleButaca(codigo, btn) {
  if (seleccionadas.has(codigo)) {
    seleccionadas.delete(codigo);
    btn.classList.remove('seleccionada');
  } else {
    seleccionadas.add(codigo);
    btn.classList.add('seleccionada');
  }
  actualizarResumen();
}

function actualizarResumen() {
  document.getElementById('cantidadSeleccionada').textContent = seleccionadas.size;
  const total = seleccionadas.size * (datosEvento ? datosEvento.precioButaca : 0);
  document.getElementById('totalSeleccionado').textContent = total;
}

document.getElementById('btnRefrescar').addEventListener('click', () => cargarMapa(funcionActual));

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
      funcionId: funcionActual, nombrePadre, celular: celularPadre, asientos: Array.from(seleccionadas)
    });
    mostrarResultadoCompra(venta);
    seleccionadas.clear();
    e.target.reset();
    await cargarMapa(funcionActual);
  } catch (err) {
    mostrarMsg(msg, err.message, 'error');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Reservar butacas seleccionadas';
  }
});

const LS_RESERVA_PENDIENTE = 'boleteria_reserva_pendiente';

async function mostrarResultadoCompra(venta, recuperada) {
  localStorage.setItem(LS_RESERVA_PENDIENTE, JSON.stringify(venta));

  const minutos = (datosEvento && datosEvento.minutosExpiracionReserva) || 20;
  const cont = document.getElementById('resultadoCompra');
  cont.hidden = false;
  cont.innerHTML = `
    <h2>${recuperada ? 'Tienes una reserva pendiente' : '¡Reserva registrada!'}</h2>
    <p>Función: <strong>${venta.funcionNombre}</strong></p>
    <p>Código de venta: <strong>${venta.ventaId}</strong></p>
    <p>Butacas: <strong>${venta.asientos.join(', ')}</strong></p>
    <p>Total a pagar: <strong>Bs ${venta.total}</strong></p>
    <p>Escanea el QR de pago (${datosEvento.qrPagoInfo || 'ver con administración'}):</p>
    ${datosEvento.qrPagoURL ? `<img class="qr-img" src="${datosEvento.qrPagoURL}" alt="QR de pago">` : '<p><em>El colegio aún no configuró el QR de pago.</em></p>'}
    <p>Guarda este comprobante:</p>
    <canvas id="canvasComprobante"></canvas>
    <p><small>⚠️ Si no subes tu comprobante de pago en los próximos <strong>${minutos} minutos</strong>, la reserva se cancela automáticamente y la butaca vuelve a estar disponible para otra persona.</small></p>

    <div class="subir-comprobante">
      <h3>Sube la captura de tu pago</h3>
      <p><small>Foto o captura de pantalla del Yape/Plin/transferencia, para que el colegio confirme más rápido.</small></p>
      <label>
        Imagen del comprobante
        <input type="file" id="inputComprobante" accept="image/*">
      </label>
      <button id="btnSubirComprobante" class="btn-primario" type="button">Subir comprobante</button>
      <div id="msgComprobante" class="msg" hidden></div>
      <button id="btnDescartarReserva" class="btn-secundario" type="button" style="margin-top:8px;width:100%;">No es mi reserva / descartar</button>
    </div>
  `;
  cont.scrollIntoView({ behavior: 'smooth' });

  const texto = `VENTA:${venta.ventaId}|EVENTO:${venta.nombreEvento}|FUNCION:${venta.funcionNombre}|BUTACAS:${venta.asientos.join(',')}|TOTAL:${venta.total}`;
  const canvas = document.getElementById('canvasComprobante');
  await QRCode.toCanvas(canvas, texto, { width: 200 });

  document.getElementById('btnDescartarReserva').addEventListener('click', () => {
    localStorage.removeItem(LS_RESERVA_PENDIENTE);
    cont.hidden = true;
    cont.innerHTML = '';
  });

  document.getElementById('btnSubirComprobante').addEventListener('click', () => subirComprobantePago(venta.ventaId));
}

async function subirComprobantePago(ventaId) {
  const input = document.getElementById('inputComprobante');
  const msg = document.getElementById('msgComprobante');
  ocultarMsg(msg);

  if (!input.files || input.files.length === 0) {
    mostrarMsg(msg, 'Selecciona una imagen del comprobante.', 'error');
    return;
  }
  const file = input.files[0];
  const base64 = await archivoABase64(file);
  const boton = document.getElementById('btnSubirComprobante');
  boton.disabled = true;
  boton.textContent = 'Subiendo…';

  try {
    await llamarApi('subirComprobante', { ventaId, imagenBase64: base64, mimeType: file.type });
    localStorage.removeItem(LS_RESERVA_PENDIENTE);
    mostrarMsg(msg, 'Comprobante enviado. El colegio confirmará tu compra pronto.', 'ok');
    boton.textContent = 'Comprobante enviado ✓';
    document.getElementById('btnDescartarReserva').hidden = true;
  } catch (err) {
    mostrarMsg(msg, err.message, 'error');
    boton.disabled = false;
    boton.textContent = 'Subir comprobante';
  }
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
        <td>${v.FuncionNombre}</td>
        <td>${isNaN(fecha) ? v.Fecha : fecha.toLocaleString()}</td>
        <td>${v.NombrePadre}</td>
        <td>${v.Celular}</td>
        <td>${v.Butacas}</td>
        <td>Bs ${v.Total}</td>
        <td>${v.ComprobanteURL ? `<a href="${v.ComprobanteURL}" target="_blank" rel="noopener">Ver</a>` : '—'}</td>
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

// ---------- Acceso al panel admin (oculto para padres) ----------
// La pestaña "Panel Admin" solo aparece si se entra con ?admin=1 en la URL.
// El acceso real sigue protegido por la clave de administrador (verificada en el servidor).
function revisarAccesoAdmin() {
  const params = new URLSearchParams(location.search);
  if (params.get('admin') === '1') {
    const btnAdmin = document.getElementById('btnTabAdmin');
    btnAdmin.classList.remove('oculto');
    btnAdmin.click();
  }
}

// ---------- Recuperar reserva pendiente (ej. si la página se refrescó por error) ----------
function restaurarReservaPendiente() {
  const guardada = localStorage.getItem(LS_RESERVA_PENDIENTE);
  if (!guardada) return;
  try {
    const venta = JSON.parse(guardada);
    mostrarResultadoCompra(venta, true);
  } catch (err) {
    localStorage.removeItem(LS_RESERVA_PENDIENTE);
  }
}

// ---------- Inicio ----------
cargarMapa().then(restaurarReservaPendiente);
revisarAccesoAdmin();

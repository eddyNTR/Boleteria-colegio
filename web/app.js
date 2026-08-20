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
    if (btn.dataset.subtab === 'funciones') renderListaFunciones();
  });
});

// ---------- Selector de función (día) ----------
// Botones en vez de un desplegable, así ambas funciones quedan visibles a la vez.
function poblarSelectorFunciones() {
  const cont = document.getElementById('funcionBotones');
  cont.innerHTML = '';
  datosEvento.funciones.forEach(f => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'funcion-btn' + (f.id === datosEvento.funcionActual ? ' active' : '');
    btn.textContent = f.nombre;
    btn.addEventListener('click', () => {
      if (f.id === funcionActual) return;
      seleccionadas.clear();
      cargarMapa(f.id);
    });
    cont.appendChild(btn);
  });
}

// ---------- Mapa de butacas ----------
async function cargarMapa(funcionId) {
  const seatMap = document.getElementById('seatMap');
  const msg = document.getElementById('msgComprar');
  mostrarMsg(msg, 'Cargando butacas…', 'info');
  try {
    datosEvento = await llamarApi('getDatosIniciales', funcionId ? { funcionId } : undefined);
    funcionActual = datosEvento.funcionActual;
    document.getElementById('nombreEvento').textContent = datosEvento.nombreEvento || 'Venta de Butacas';
    document.title = datosEvento.nombreEvento || 'Venta de Butacas';
    poblarSelectorFunciones();
    renderMapa();
    actualizarQrPagoEnFormulario();
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
  actualizarQrPagoEnFormulario();
}

// Muestra el QR de pago y el monto dentro del propio formulario, antes de comprar.
function actualizarQrPagoEnFormulario() {
  const img = document.getElementById('qrPagoImg');
  const texto = document.getElementById('qrPagoInfoTexto');
  if (!datosEvento) return;

  if (seleccionadas.size === 0) {
    texto.innerHTML = '<small>Selecciona butacas arriba para ver el monto exacto.</small>';
    img.hidden = true;
    return;
  }

  const total = seleccionadas.size * datosEvento.precioButaca;
  texto.innerHTML = `Monto a pagar: <strong>Bs ${total}</strong> — ${datosEvento.qrPagoInfo || 'ver con administración'}`;
  if (datosEvento.qrPagoURL) {
    img.src = datosEvento.qrPagoURL;
    img.hidden = false;
  } else {
    img.hidden = true;
  }
}

document.getElementById('btnRefrescar').addEventListener('click', () => cargarMapa(funcionActual));

// ---------- Método de pago (QR vs. efectivo) ----------
document.querySelectorAll('input[name="metodoPago"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const esQr = document.querySelector('input[name="metodoPago"]:checked').value === 'qr';
    document.getElementById('bloqueQrPago').hidden = !esQr;
    document.getElementById('bloqueEfectivo').hidden = esQr;
    document.getElementById('inputComprobante').required = esQr;
  });
});

// ---------- Formulario de compra ----------
// Todo se envía junto (asientos + datos + comprobante) en un solo paso: la butaca
// recién se bloquea cuando la venta ya está completa con el comprobante adjunto.
// Así, si el padre refresca o cierra antes de terminar, no queda nada reservado.
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
  const metodoPago = document.querySelector('input[name="metodoPago"]:checked').value;
  const inputComprobante = document.getElementById('inputComprobante');

  if (metodoPago === 'qr' && (!inputComprobante.files || inputComprobante.files.length === 0)) {
    mostrarMsg(msg, 'Adjunta la imagen del comprobante de pago.', 'error');
    return;
  }

  const boton = e.target.querySelector('button[type="submit"]');
  boton.disabled = true;
  boton.textContent = 'Procesando…';

  try {
    let imagenBase64 = null;
    let mimeType = null;
    if (metodoPago === 'qr') {
      const file = inputComprobante.files[0];
      imagenBase64 = await archivoABase64(file);
      mimeType = file.type;
    }

    const venta = await llamarApi('crearVenta', {
      funcionId: funcionActual,
      nombrePadre,
      celular: celularPadre,
      asientos: Array.from(seleccionadas),
      metodoPago,
      imagenBase64,
      mimeType
    });

    mostrarResultadoCompra(venta);
    seleccionadas.clear();
    e.target.reset();
    await cargarMapa(funcionActual);
  } catch (err) {
    mostrarMsg(msg, err.message, 'error');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Confirmar compra';
  }
});

async function mostrarResultadoCompra(venta) {
  const cont = document.getElementById('resultadoCompra');
  cont.hidden = false;
  cont.innerHTML = `
    <h2>¡Compra registrada!</h2>
    <p>Función: <strong>${venta.funcionNombre}</strong></p>
    <p>Código de venta: <strong>${venta.ventaId}</strong></p>
    <p>Butacas: <strong>${venta.asientos.join(', ')}</strong></p>
    <p>Total pagado: <strong>Bs ${venta.total}</strong></p>
    <p>Guarda este comprobante:</p>
    <canvas id="canvasComprobante"></canvas>
    <p><small>Tu butaca queda <strong>reservada</strong> hasta que el colegio confirme tu pago.</small></p>
  `;
  cont.scrollIntoView({ behavior: 'smooth' });

  const texto = `VENTA:${venta.ventaId}|EVENTO:${venta.nombreEvento}|FUNCION:${venta.funcionNombre}|BUTACAS:${venta.asientos.join(',')}|TOTAL:${venta.total}`;
  const canvas = document.getElementById('canvasComprobante');
  await QRCode.toCanvas(canvas, texto, { width: 200 });
}

// ---------- Admin: login ----------
const SS_ADMIN_PASSWORD = 'boleteria_admin_password';

let sheetUrl = null;

async function entrarComoAdmin(clave, msgEl) {
  await llamarApi('adminLogin', { password: clave });
  adminPassword = clave;
  sessionStorage.setItem(SS_ADMIN_PASSWORD, clave);
  document.getElementById('loginAdmin').hidden = true;
  document.getElementById('panelAdmin').hidden = false;
  await cargarVentas();
  await cargarQRActual();
  try {
    sheetUrl = await llamarApi('adminObtenerSheetUrl', { password: adminPassword });
  } catch (err) { /* no crítico si falla */ }
}

document.getElementById('btnLoginAdmin').addEventListener('click', async () => {
  const clave = document.getElementById('claveAdmin').value;
  const msg = document.getElementById('msgLoginAdmin');
  try {
    await entrarComoAdmin(clave, msg);
  } catch (err) {
    mostrarMsg(msg, err.message, 'error');
  }
});

document.getElementById('btnCerrarSesionAdmin').addEventListener('click', () => {
  sessionStorage.removeItem(SS_ADMIN_PASSWORD);
  adminPassword = null;
  document.getElementById('claveAdmin').value = '';
  document.getElementById('panelAdmin').hidden = true;
  document.getElementById('loginAdmin').hidden = false;
});

// Botón "Acceso administrador" visible desde la página principal: revela la pestaña
// y, si hay una sesión guardada (sessionStorage, dura hasta cerrar la pestaña), entra directo.
document.getElementById('btnAccesoAdmin').addEventListener('click', async () => {
  const btnAdmin = document.getElementById('btnTabAdmin');
  btnAdmin.classList.remove('oculto');
  btnAdmin.click();

  const claveGuardada = sessionStorage.getItem(SS_ADMIN_PASSWORD);
  if (claveGuardada) {
    try {
      await entrarComoAdmin(claveGuardada, document.getElementById('msgLoginAdmin'));
    } catch (err) {
      sessionStorage.removeItem(SS_ADMIN_PASSWORD);
    }
  }
});

// ---------- Admin: ventas ----------
let ventasCache = [];

document.getElementById('btnRefrescarVentas').addEventListener('click', cargarVentas);
document.getElementById('btnExportarSheet').addEventListener('click', async () => {
  // Abrimos la pestaña vacía YA, en el mismo instante del clic (sin await antes),
  // porque si esperamos a la respuesta del servidor primero, el navegador ya no lo
  // reconoce como una acción directa del usuario y bloquea el popup.
  const nuevaVentana = window.open('about:blank', '_blank');

  if (!sheetUrl) {
    try { sheetUrl = await llamarApi('adminObtenerSheetUrl', { password: adminPassword }); } catch (err) { /* ignorar */ }
  }

  if (sheetUrl && nuevaVentana) {
    nuevaVentana.location.href = sheetUrl;
  } else {
    if (nuevaVentana) nuevaVentana.close();
    alert('No se pudo obtener el enlace al Google Sheet. Ábrelo directamente desde tu Google Drive.');
  }
});

document.getElementById('buscarVentas').addEventListener('input', (e) => {
  renderTablaVentas(filtrarVentas(ventasCache, e.target.value));
});

function filtrarVentas(ventas, termino) {
  const t = termino.trim().toLowerCase();
  if (!t) return ventas;
  return ventas.filter(v => [v.ID, v.FuncionNombre, v.NombrePadre, v.Celular, v.Butacas, v.Estado]
    .some(campo => String(campo || '').toLowerCase().includes(t)));
}

async function cargarVentas() {
  const msg = document.getElementById('msgVentas');
  mostrarMsg(msg, 'Cargando ventas…', 'info');
  try {
    ventasCache = await llamarApi('adminGetVentas', { password: adminPassword });
    const termino = document.getElementById('buscarVentas').value;
    renderTablaVentas(filtrarVentas(ventasCache, termino));
    ocultarMsg(msg);
  } catch (err) {
    mostrarMsg(msg, err.message, 'error');
  }
}

// Una pestaña por función (Miércoles / Jueves): cada una redirige a su propia
// tabla, en vez de mostrarlas todas apiladas una debajo de la otra.
let funcionVentasActiva = null;

function renderTablaVentas(ventas) {
  const tabsCont = document.getElementById('funcionVentasTabs');
  const cont = document.getElementById('ventasPorFuncion');
  tabsCont.innerHTML = '';
  cont.innerHTML = '';

  const funciones = (datosEvento && datosEvento.funciones) || [];
  const grupos = funciones.length
    ? funciones.map(f => ({ id: f.id, nombre: f.nombre }))
    : Array.from(new Map(ventas.map(v => [v.FuncionID, v.FuncionNombre])))
        .map(([id, nombre]) => ({ id, nombre }));

  if (!grupos.some(g => g.id === funcionVentasActiva)) {
    funcionVentasActiva = grupos.length ? grupos[0].id : null;
  }

  grupos.forEach(grupo => {
    const ventasGrupo = ventas.filter(v => v.FuncionID === grupo.id);

    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'subtab-btn' + (grupo.id === funcionVentasActiva ? ' active' : '');
    tab.textContent = `${grupo.nombre} (${ventasGrupo.length})`;
    tab.addEventListener('click', () => {
      funcionVentasActiva = grupo.id;
      renderTablaVentas(ventas);
    });
    tabsCont.appendChild(tab);

    const seccion = document.createElement('div');
    seccion.className = 'ventas-funcion' + (grupo.id === funcionVentasActiva ? '' : ' oculto');
    seccion.innerHTML = `
      <div class="tabla-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th><th>Fecha</th><th>Padre/Madre</th><th>Celular</th>
              <th>Butacas</th><th>Total</th><th>Método</th><th>Comprobante</th><th>Estado</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    `;
    cont.appendChild(seccion);

    const tbody = seccion.querySelector('tbody');
    ventasGrupo.forEach(v => {
      const tr = document.createElement('tr');
      const fecha = new Date(v.Fecha);
      tr.innerHTML = `
        <td>${v.ID}</td>
        <td>${isNaN(fecha) ? v.Fecha : fecha.toLocaleString()}</td>
        <td>${v.NombrePadre}</td>
        <td>${v.Celular}</td>
        <td>${v.Butacas}</td>
        <td>Bs ${v.Total}</td>
        <td>${v.MetodoPago === 'efectivo' ? 'Efectivo' : 'QR'}</td>
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
    if (ventasGrupo.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="10" style="text-align:center;color:#64748b;">Sin resultados</td>`;
      tbody.appendChild(tr);
    }
  });
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
  mostrarMsg(msg, 'Subiendo QR…', 'info');

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

// ---------- Admin: nombres de funciones ----------
function renderListaFunciones() {
  const cont = document.getElementById('listaFunciones');
  cont.innerHTML = '';
  if (!datosEvento) return;

  datosEvento.funciones.forEach(f => {
    const fila = document.createElement('div');
    fila.className = 'funcion-editar';
    fila.innerHTML = `
      <input type="text" value="${f.nombre.replace(/"/g, '&quot;')}" class="funcion-editar-input">
      <button type="button" class="btn-secundario funcion-editar-btn">Guardar</button>
    `;
    const input = fila.querySelector('input');
    fila.querySelector('button').addEventListener('click', async () => {
      const msg = document.getElementById('msgFunciones');
      try {
        await llamarApi('adminActualizarFuncion', { password: adminPassword, funcionId: f.id, nombre: input.value.trim() });
        f.nombre = input.value.trim();
        mostrarMsg(msg, 'Nombre actualizado.', 'ok');
        poblarSelectorFunciones();
        renderTablaVentas(ventasCache);
      } catch (err) {
        mostrarMsg(msg, err.message, 'error');
      }
    });
    cont.appendChild(fila);
  });
}

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
async function revisarAccesoAdmin() {
  const params = new URLSearchParams(location.search);
  if (params.get('admin') === '1') {
    document.getElementById('btnAccesoAdmin').click();
  }
}

// ---------- Inicio ----------
cargarMapa();
revisarAccesoAdmin();

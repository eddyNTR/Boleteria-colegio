# Venta de Butacas — Evento Escolar

Sistema simple para vender butacas de un evento escolar:
- Mapa de butacas visual (disponible / reservada / vendida).
- Los padres seleccionan una o varias butacas, dejan su nombre y celular, y reciben un QR de comprobante.
- El pago se hace por fuera del sistema usando un QR de pago **estático que solo el administrador puede cambiar**.
- Panel de administración (rol `admin`) para confirmar/cancelar ventas y ver todo en Google Sheets.
- Rol `padre/comprador`: solo compra, no necesita cuenta ni contraseña.

## Arquitectura

- **Base de datos y backend**: Google Sheets + Google Apps Script (`Code.gs`), publicado como una API JSON (Web App).
- **Frontend**: HTML/CSS/JS simple y responsive en la carpeta `web/`, desplegado en **Vercel** (gratis, con link compartible).

```
Padres/Admin (navegador, celular o PC)
        │
        ▼
  Vercel (web/)  ──fetch──►  Apps Script Web App (Code.gs)  ──►  Google Sheet (Config / Butacas / Ventas)
```

---

## 1. Configurar el backend (Google Apps Script)

1. Crea un Google Sheet nuevo (ej. "Boletería Evento Escolar").
2. Ve a **Extensiones > Apps Script**.
3. Borra el contenido de `Code.gs` que aparece por defecto y pega el contenido de [Code.gs](Code.gs) de este proyecto.
4. Guarda el proyecto (nombre sugerido: "Boleteria API").
5. En el editor, selecciona la función `setupInicial` en el desplegable de funciones (arriba) y ejecútala (▶). Esto crea las hojas `Config`, `Butacas` y `Ventas`, y genera el mapa de butacas (por defecto 8 filas x 10 butacas — cámbialo en la hoja `Config` y vuelve a ejecutar `regenerarButacas_` si quieres otro tamaño, **antes** de tener ventas reales).
6. Autoriza los permisos que pida Google (Sheets + Drive, este último para guardar la imagen del QR de pago).
7. En la hoja `Config`, cambia el valor de `AdminPassword` por una clave real que solo conozcan las secretarias/administradores.
8. Despliega como Web App: **Implementar > Nueva implementación**
   - Tipo: **Aplicación web**
   - Ejecutar como: **Yo (tu cuenta)**
   - Quién tiene acceso: **Cualquier usuario** (necesario para que la app funcione sin que cada padre inicie sesión en Google)
9. Copia la **URL de la implementación** (termina en `/exec`). La necesitas para el frontend.

> Cada vez que edites `Code.gs`, debes crear una **nueva versión** de la implementación (Implementar > Gestionar implementaciones > editar > Nueva versión) para que los cambios se reflejen en la URL pública.

## 2. Configurar el frontend (`web/`)

1. Abre `web/config.js` y reemplaza la URL de ejemplo por la URL `/exec` que copiaste:
   ```js
   const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
   ```
2. Pruébalo localmente abriendo `web/index.html` en el navegador (o con un servidor estático simple).

## 3. Desplegar en Vercel

1. Sube esta carpeta a un repositorio de GitHub (o usa `vercel` CLI directo desde tu máquina).
2. En [vercel.com](https://vercel.com), **New Project** → importa el repo.
3. En **Root Directory**, selecciona la carpeta `web`.
4. Framework Preset: **Other** (es HTML/CSS/JS plano, no necesita build).
5. Deploy. Vercel te da un link público (`tu-proyecto.vercel.app`) que puedes compartir con los padres — funciona bien en celular porque el diseño es responsive (mobile-first).

Si prefieres la CLI:
```bash
cd web
npx vercel --prod
```

## 4. Uso diario

- **Padres/compradores**: entran al link normal de Vercel (`tu-proyecto.vercel.app`). Ahí **no aparece** la pestaña "Panel Admin" — solo ven el mapa de butacas, seleccionan las que quieren, ponen su nombre y celular, y quedan **reservadas** (amarillo). Ven el QR de pago y, tras pagar, guardan su comprobante (QR generado con su código de venta).
- **Administrador/secretaria**: entra con el link especial `tu-proyecto.vercel.app/?admin=1` — ahí sí aparece la pestaña "Panel Admin". Ingresa con la clave de `Config > AdminPassword` (la contraseña sigue siendo la protección real, el link solo evita que los padres vean el botón). Ahí puede:
  - Ver todas las ventas (también visibles directamente en la hoja `Ventas` del Google Sheet).
  - **Confirmar** una venta (verificó el pago) → la butaca pasa a "vendida".
  - **Cancelar** una venta (no pagó) → la butaca vuelve a estar disponible.
  - Subir/cambiar el **QR de pago estático** (hoja `Config > QRPagoURL`, guardado en Drive).

## Notas y límites (a propósito, por ser un proyecto simple)

- No hay contraseñas para padres: es solo nombre + celular, pensado para un evento puntual, no un sistema con cuentas persistentes.
- La clave de administrador se valida en el servidor (Apps Script) en cada acción, pero viaja en texto plano — suficiente para este caso de uso, no para datos sensibles.
- La verificación del pago es manual (el admin revisa que llegó el pago y confirma en el panel); el sistema no procesa pagos automáticamente.
- Si necesitan más de un evento a la vez, hay que duplicar el Google Sheet + implementación de Apps Script.

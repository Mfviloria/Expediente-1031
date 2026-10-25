# ¿Quién asesinó al Data Scientist? — proyecto con panel de facilitador

- **Jugadores:** abren `/` y solo ven el juego. Primero escriben el nombre del aquelarre y luego aparecen las pistas.
- **Facilitador:** abre `/facilitador`, escribe la contraseña y ve, en vivo, cada equipo con su estado, las pistas que abrió (cuadros 1–8), ayudas, fallos, puntos, tiempo, sospechosos descartados y a quién acusó. Los jugadores no tienen enlace a esa página y sin contraseña no reciben datos.

## Requisitos
Node.js 18 o superior. No hay que instalar nada más.

## Uso local (mismo Wi-Fi)
```bash
cd quien-asesino-ds
FACILITATOR_PASSWORD=tu_clave node server.js      # Windows PowerShell: $env:FACILITATOR_PASSWORD="tu_clave"; node server.js
```
- Tú: `http://localhost:3000/facilitador`
- Jugadores: `http://IP-DE-TU-PC:3000/` (la IP local de tu computador, p. ej. 192.168.1.20). Si no puedes alcanzar el puerto, permite Node en el firewall.
- Si no defines `FACILITATOR_PASSWORD`, se genera una contraseña temporal y se imprime en la consola.

## Publicarlo en internet
En Netlify, `netlify.toml` publica la carpeta `public`, que contiene la página principal, y sirve el panel en `/facilitador`. No se necesita un comando de compilación para estas páginas.

Las rutas `/api/*` se ejecutan en Netlify Functions. El avance de los equipos, las sesiones y el límite de intentos de acceso se guardan en Netlify Database. Las tablas se crean automáticamente al publicar mediante las migraciones incluidas.

### Activar el facilitador en Netlify

1. Abre el proyecto **expediente1031** en Netlify y entra en **Project configuration → Environment variables → Add a variable**.
2. Crea la variable `FACILITATOR_PASSWORD`. Escribe allí tu contraseña privada de temática de terror, preferiblemente una frase larga. No la guardes en el repositorio ni la compartas con los equipos. Si Netlify muestra ámbitos, incluye **Functions**, y selecciona el contexto **Production** (y **Deploy Previews** si quieres probar también allí).
3. Guarda y publica de nuevo desde **Deploys → Trigger deploy → Deploy site**, después de incorporar estos cambios.
4. Abre **https://expediente1031.netlify.app/facilitador** e introduce la contraseña que configuraste.
5. Comparte únicamente **https://expediente1031.netlify.app/** con los equipos.

Los equipos pueden encontrar la pantalla de acceso, pero no pueden consultar ni limpiar el tablero sin la contraseña y una sesión válida. La contraseña se verifica en el servidor y nunca se incluye en el HTML. Las sesiones caducan tras 12 horas y se invalidan al cambiar la contraseña y volver a publicar. Usa **Salir** al terminar, especialmente en un equipo compartido.

Si falta la variable, el acceso permanece desactivado y muestra las instrucciones de configuración. No hay contraseña predeterminada. Las sesiones se guardan mediante huellas de sus identificadores; la cookie usa `HttpOnly`, `Secure` y `SameSite=Strict`. Se permiten diez intentos por minuto y dirección IP.

Sirve en cualquier hosting de Node (Render, Railway, Fly.io, un VPS...): comando de inicio `node server.js`, variable `FACILITATOR_PASSWORD`, y que el hosting ponga HTTPS (si va detrás de un proxy, `TRUST_PROXY=1`). Variables opcionales: `PORT`, `DATA_DIR`.

## Notas
- El tablero se guarda en `data/board.json`; en hostings gratuitos se borra al reiniciar. «Limpiar tablero» lo vacía.
- Cada navegador es un equipo (se identifica con un código guardado en el navegador). Reiniciar el caso borra a ese equipo del tablero.
- Es un juego de clase: los jugadores técnicos podrían enviar datos falsos al servidor. No lo uses para algo con premio serio.
- Estructura: `server.js` (servidor y API), `public/index.html` (juego), `public/facilitador.html` (panel).
# Expediente-1031

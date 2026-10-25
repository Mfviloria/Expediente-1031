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
Sirve en cualquier hosting de Node (Render, Railway, Fly.io, un VPS...): comando de inicio `node server.js`, variable `FACILITATOR_PASSWORD`, y que el hosting ponga HTTPS (si va detrás de un proxy, `TRUST_PROXY=1`). Variables opcionales: `PORT`, `DATA_DIR`.

## Notas
- El tablero se guarda en `data/board.json`; en hostings gratuitos se borra al reiniciar. «Limpiar tablero» lo vacía.
- Cada navegador es un equipo (se identifica con un código guardado en el navegador). Reiniciar el caso borra a ese equipo del tablero.
- Es un juego de clase: los jugadores técnicos podrían enviar datos falsos al servidor. No lo uses para algo con premio serio.
- Estructura: `server.js` (servidor y API), `public/index.html` (juego), `public/facilitador.html` (panel).
# Expediente-1031

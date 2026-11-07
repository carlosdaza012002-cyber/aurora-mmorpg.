# AURORA MMORPG — versión 0.3 (animaciones + base PostgreSQL)

Cliente 3D web y servidor Node.js/Socket.IO para pruebas iniciales. Incluye animación procedural de espera, caminar y correr, suavizado de movimiento remoto y persistencia PostgreSQL opcional.

## Requisitos
- Node.js 20 o superior.
- Para el servidor: PC o hosting Node.js. El teléfono Android puede conectarse como cliente, pero no es recomendable alojar el servidor desde el navegador del teléfono.
- PostgreSQL 14+ (Neon, Supabase, Render u otro proveedor compatible) para cuentas persistentes en producción.

## Probar localmente sin PostgreSQL
1. Descomprime el ZIP en un PC.
2. Abre una terminal en la carpeta y ejecuta `npm install`.
3. Copia `.env.example` a `.env`; configura `TOKEN_SECRET` con una clave aleatoria larga.
4. Si `DATABASE_URL` está vacío, el prototipo usa `data/users.json` (solo desarrollo).
5. Ejecuta `npm start` y abre `http://localhost:3000`.
6. Para probar desde Android en el mismo Wi-Fi, abre `http://IP-LOCAL-DEL-PC:3000`.

## Activar PostgreSQL
1. Crea una base de datos PostgreSQL en tu proveedor.
2. Copia la cadena de conexión y colócala en `DATABASE_URL` dentro de las variables de entorno del hosting o en `.env` local.
3. Si el proveedor exige TLS, configura `DATABASE_SSL=true` según sus instrucciones.
4. Ejecuta `npm install` y `npm start`. Al iniciar, el servidor crea la tabla `users` e índice si no existen.
5. Revisa `GET /api/status`: debe indicar `storage: "postgres"`.

**Importante:** el esquema se crea automáticamente. El proyecto no migra automáticamente las cuentas existentes de `data/users.json` a PostgreSQL; antes de cambiar de almacenamiento hay que exportarlas e importarlas con un proceso seguro. No subas `.env` ni compartas la URL de conexión.

## Mejoras de esta versión
- Animación de espera con respiración sutil.
- Ciclos diferenciados de caminar y correr; en PC mantén `Shift` mientras te mueves y en móvil usa el botón `⚡ Correr`.
- Los avatares remotos interpolan posiciones para reducir saltos de red y animan sus piernas/brazos cuando reciben movimiento.
- Persistencia de usuarios en PostgreSQL cuando existe `DATABASE_URL`; JSON queda solo como modo local de prueba.
- Tabla de cuentas con UUID, email único, clase, salt y hash de contraseña.
- API asíncrona y pool de conexiones PostgreSQL.
- Salas Socket.IO por zona (por ahora una zona: `valle-aurora-1`).
- Validación de movimiento y límite básico contra saltos/teletransportes.
- Límite básico de intentos de login/registro en una sola instancia.

## Lo que aún NO está listo para producción
- El movimiento todavía es una simulación cliente-servidor; falta simulación completamente autoritativa, reconciliación y predicción.
- Una zona única y un proceso Node.js no prueban capacidad para 200 jugadores concurrentes.
- El limitador de autenticación está en memoria y debe cambiarse por Redis o almacén compartido al usar varias instancias.
- Para escalar: Redis + adaptador Socket.IO, balanceador con afinidad de sesión (o WebSocket compatible), métricas, logs, alertas, pruebas de carga y partición de mundo por zonas.
- Para producción: HTTPS, secretos seguros, cookies HttpOnly/SameSite, protección CSRF según autenticación, rate limiting distribuido, backups, política de privacidad, moderación y recuperación de cuenta.
- No se incluye todavía inventario, combate, monstruos ni persistencia de progreso del personaje.

## Archivos
- `server.js`: API, autenticación y multijugador Socket.IO.
- `db.js`: capa de persistencia PostgreSQL/JSON.
- `public/index.html`: interfaz y controles.
- `public/game.js`: Three.js, avatares y animación.
- `public/style.css`: estilos.
- `.env.example`: variables de entorno de ejemplo.

## Siguiente fase sugerida
1. Importador de usuarios JSON a PostgreSQL con verificación de duplicados.
2. Persistencia de personaje, inventario y progreso.
3. Redis/adaptador Socket.IO y zonas múltiples.
4. Prueba de carga gradual (10, 25, 50, 100, 200) y medición de CPU, RAM, latencia y desconexiones.

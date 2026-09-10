/**
 * Configuración de pm2 para SEO Crawler.
 *
 * Pensada para un VPS donde pm2 YA gestiona otros proyectos: los dos
 * procesos van bajo el namespace `seocrawler` y con nombres prefijados, así
 * que se pueden arrancar, parar y borrar sin tocar lo que ya hubiera.
 *
 *   cd /var/www/seocrawler
 *   pm2 start deploy/ecosystem.config.js
 *   pm2 save
 *
 * Nunca `pm2 delete all` ni `pm2 kill` en este servidor: se llevarían por
 * delante los procesos de los demás proyectos. Para actuar sólo sobre los
 * de esta app, usa el namespace:
 *
 *   pm2 restart /seocrawler
 *   pm2 stop    /seocrawler
 *   pm2 delete  /seocrawler
 */

// Puerto local de la app. Elígelo con deploy/check-ports.sh y cámbialo aquí.
const PORT = process.env.SEOCRAWLER_PORT || '3210';

// Raíz del despliegue. Tiene que ser la carpeta del proyecto: tanto Next como
// el worker leen el `.env` relativo al directorio de trabajo.
const ROOT = '/var/www/seocrawler';

/**
 * Node con el que ejecutar los dos procesos.
 *
 * pm2 usa por defecto el Node con el que se lanzó el demonio, que en un VPS
 * con proyectos antiguos puede ser una versión anterior a la 20. Descomenta
 * y pon la ruta del Node nuevo (`which node`) sin actualizar el del sistema,
 * que rompería a los demás.
 */
// const NODE = '/home/seocrawler/.nvm/versions/node/v20.18.0/bin/node';
const NODE = undefined;

const interpreter = NODE ? { interpreter: NODE } : {};

module.exports = {
  apps: [
    {
      name: 'seocrawler-web',
      namespace: 'seocrawler',
      cwd: ROOT,

      // Se apunta al binario de Next en lugar de a `npm run start` a
      // propósito: con npm de por medio queda un proceso intermedio que se
      // traga las señales, y `pm2 restart` acaba matando el padre y dejando
      // huérfano al servidor.
      ...interpreter,
      script: './node_modules/next/dist/bin/next',

      // `-H 127.0.0.1` es obligatorio: Next lee el puerto de la variable
      // PORT pero el host no, y sin este flag escucharía en 0.0.0.0,
      // quedando accesible por IP:puerto sin pasar por nginx ni por TLS.
      args: `start -H 127.0.0.1 -p ${PORT}`,

      // Un solo proceso en modo fork. El modo cluster de pm2 no aporta aquí:
      // quien encaja el tráfico es nginx, y varias instancias sólo
      // multiplicarían la memoria.
      instances: 1,
      exec_mode: 'fork',

      // Next carga el .env por su cuenta; pm2 no necesita inyectarlo.
      env: { NODE_ENV: 'production' },

      autorestart: true,
      max_restarts: 10,
      min_uptime: '20s',
      max_memory_restart: '768M',

      error_file: `${ROOT}/logs/web.error.log`,
      out_file: `${ROOT}/logs/web.out.log`,
      merge_logs: true,
      time: true,
    },

    {
      name: 'seocrawler-worker',
      namespace: 'seocrawler',
      cwd: ROOT,

      // El worker es TypeScript y se ejecuta con tsx, que está en
      // devDependencies: si despliegas con `npm ci --omit=dev` este proceso
      // no arranca y no se rastrea nada.
      ...interpreter,
      script: './node_modules/tsx/dist/cli.mjs',
      args: 'src/workers/crawl-worker.ts',

      // Nunca más de una instancia sin pensarlo. La cola reparte los crawls
      // con un bloqueo por fila, así que varios workers son seguros, pero
      // cada uno rastrea en paralelo y multiplica el consumo del VPS.
      instances: 1,
      exec_mode: 'fork',

      env: { NODE_ENV: 'production' },

      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',

      // Un rastreo grande carga en memoria el grafo del sitio para calcular
      // PageRank y comunidades. Si se dispara, mejor reiniciar que dejar al
      // VPS sin RAM y arrastrar a los demás proyectos.
      max_memory_restart: '1G',

      // Los crawls son largos: hay que darle margen para cerrar antes de
      // que pm2 lo mate a la fuerza.
      kill_timeout: 15000,

      error_file: `${ROOT}/logs/worker.error.log`,
      out_file: `${ROOT}/logs/worker.out.log`,
      merge_logs: true,
      time: true,
    },
  ],
};

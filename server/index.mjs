import { resolve } from 'node:path';
import { createApp } from './app.mjs';

const port = Number(process.env.PORT ?? 3400);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
const host = process.env.HOST ?? '127.0.0.1';
const origin = process.env.KEYDOCK_ORIGIN ?? `http://127.0.0.1:${port}`;
const directory = resolve(process.env.KEYDOCK_DATA_DIR ?? 'data');
const app = await createApp({ directory, origin, logger: true });
let closing = false;
async function shutdown() { if (closing) return; closing = true; await app.close(); }
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
try {
  await app.listen({ host, port });
  app.log.info({ origin, directory }, 'Keydock ready');
  if (!app.store.get('SELECT id FROM users LIMIT 1')) app.log.info('First run: retrieve setupToken from data/identity.json using a private terminal, then open the configured origin. The token is never printed to logs.');
} catch (error) { app.log.error({ code: error.code }, 'Unable to start Keydock'); await app.close(); process.exitCode = 1; }

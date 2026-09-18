#!/usr/bin/env node
const Application = require('./src/app/application');

async function bootstrap() {
  const app = new Application();
  await app.start();
}

bootstrap().catch(err => {
  console.error('\n  [!] Error crítico al iniciar la aplicación:', err);
  process.exit(1);
});
const Application = require('./src/app/application');

async function bootstrap() {
  try {
    await new Application().start();
  } catch (criticalError) {
    console.error('\n  [!] Error crítico al iniciar la aplicación:', criticalError.message || criticalError);
    if (process.env.DEBUG) console.error(criticalError.stack);
    process.exit(1);
  }
}

bootstrap();

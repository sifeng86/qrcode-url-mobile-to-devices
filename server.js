require('dotenv').config();

const { createApp } = require('./src/app');
const { createConfig } = require('./src/config');

async function start() {
  const config = createConfig();
  const { server } = await createApp(config);

  server.listen(config.appPort, () => {
    console.log(`QR relay listening on port ${config.appPort}${config.basePath || '/'}`);
  });
}

start().catch((error) => {
  console.error('Failed to start QR relay:', error);
  process.exit(1);
});







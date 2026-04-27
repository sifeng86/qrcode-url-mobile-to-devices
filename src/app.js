const path = require('path');
const http = require('http');

const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const { resolvePublicOrigin, withBasePath } = require('./config');
const { loadTemplates, renderTemplate } = require('./render');
const { createSessionRepository } = require('./repository');
const { normalizeUrl, validateToken, ValidationError } = require('./validation');

const brand = {
  mark: 'SL',
  name: 'Sendline'
};

const shareCard = {
  alt: 'Sendline preview card for sending URLs across devices',
  path: '/social-card.svg'
};

function serializeForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function buildAbsoluteUrl(config, requestLike, pathname = '/') {
  return new URL(withBasePath(config, pathname), `${resolvePublicOrigin(config, requestLike)}/`).toString();
}

function createHomeStructuredData({ canonicalUrl, description, imageUrl }) {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      description,
      inLanguage: 'en',
      name: brand.name,
      url: canonicalUrl
    },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      applicationCategory: 'UtilitiesApplication',
      browserRequirements: 'Requires a modern browser with JavaScript enabled.',
      description,
      featureList: [
        'Open a receiver screen and generate a QR code instantly.',
        'Scan the QR code on your phone and paste any http or https URL.',
        'Open that URL on the other device without sign-up or login.'
      ],
      image: imageUrl,
      name: brand.name,
      operatingSystem: 'Any',
      url: canonicalUrl
    }
  ];
}

function buildSeoPayload(config, requestLike, metadata) {
  const pagePath = metadata.pagePath || '/';
  const canonicalPath = metadata.canonicalPath || pagePath;
  const pageUrl = buildAbsoluteUrl(config, requestLike, pagePath);
  const canonicalUrl = buildAbsoluteUrl(config, requestLike, canonicalPath);
  const imageUrl = buildAbsoluteUrl(config, requestLike, shareCard.path);
  const structuredData = metadata.structuredDataFactory
    ? metadata.structuredDataFactory({
        canonicalUrl,
        description: metadata.description,
        imageUrl,
        pageUrl
      })
    : [];
  const normalizedStructuredData = Array.isArray(structuredData)
    ? structuredData
    : structuredData
      ? [structuredData]
      : [];

  return {
    ...metadata,
    canonicalUrl,
    imageAlt: metadata.imageAlt || shareCard.alt,
    imageUrl,
    ogType: metadata.ogType || 'website',
    pageUrl,
    robots: metadata.robots || 'index, follow, max-image-preview:large',
    structuredDataBlock: normalizedStructuredData.length
      ? `<script type="application/ld+json">${serializeForScript(normalizedStructuredData.length === 1 ? normalizedStructuredData[0] : normalizedStructuredData)}</script>`
      : ''
  };
}

function isExpiredSession(session) {
  return Boolean(session && session.expiresAt && session.expiresAt.getTime() <= Date.now());
}

function wait(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function createApp(config) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    path: config.socketPath,
    cors: {
      origin: true,
      methods: ['GET', 'POST']
    }
  });
  const repository = createSessionRepository(config.database);
  const templates = loadTemplates(config.rootDir);

  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.use(express.urlencoded({ extended: false }));

  async function initializeDataStore() {
    for (let attempt = 1; attempt <= config.dbConnectRetries; attempt += 1) {
      try {
        await repository.initialize();
        return;
      } catch (error) {
        if (attempt === config.dbConnectRetries) {
          throw error;
        }

        console.warn(`Database not ready yet, retrying (${attempt}/${config.dbConnectRetries})...`);
        await wait(config.dbConnectRetryMs);
      }
    }
  }

  await initializeDataStore();

  const cleanupTimer = setInterval(() => {
    repository.cleanupExpiredSessions().catch((error) => {
      console.error('Failed to cleanup expired sessions:', error.message);
    });
  }, config.cleanupIntervalMs);
  cleanupTimer.unref();

  function buildClientConfig(requestLike) {
    return {
      basePath: config.basePath,
      publicAppUrl: `${resolvePublicOrigin(config, requestLike)}${config.basePath}`,
      socketPath: config.socketPath,
      routes: {
        home: withBasePath(config, '/'),
        connect: withBasePath(config, '/connect'),
        session: withBasePath(config, '/api/session'),
        relay: withBasePath(config, '/api/relay'),
        health: withBasePath(config, '/health')
      }
    };
  }

  function renderPage(response, templateName, requestLike, pageData, metadata) {
    const seo = buildSeoPayload(config, requestLike, metadata);

    response.set('X-Robots-Tag', seo.robots).type('html').send(renderTemplate(templates[templateName], {
      PAGE_TITLE: seo.title,
      PAGE_DESCRIPTION: seo.description,
      PAGE_ROBOTS: seo.robots,
      CANONICAL_URL: seo.canonicalUrl,
      PAGE_URL: seo.pageUrl,
      OG_TYPE: seo.ogType,
      OG_IMAGE_URL: seo.imageUrl,
      OG_IMAGE_ALT: seo.imageAlt,
      STRUCTURED_DATA_BLOCK: seo.structuredDataBlock,
      BRAND_MARK: brand.mark,
      BRAND_NAME: brand.name,
      HOME_PATH: withBasePath(config, '/'),
      STYLESHEET_PATH: withBasePath(config, '/assets/main.css'),
      SCRIPT_PATH: withBasePath(config, `/assets/${metadata.scriptName}`),
      SOCKET_SCRIPT_PATH: withBasePath(config, '/socket.io/socket.io.js'),
      APP_CONFIG_JSON: serializeForScript(buildClientConfig(requestLike)),
      PAGE_DATA_JSON: serializeForScript(pageData || {}),
      CURRENT_YEAR: new Date().getFullYear()
    }));
  }

  function renderNotFoundPage(response, requestLike) {
    const seo = buildSeoPayload(config, requestLike, {
      canonicalPath: '/',
      description: 'The page you requested does not exist.',
      pagePath: '/',
      robots: 'noindex, nofollow, noarchive',
      title: `Page not found | ${brand.name}`
    });

    response.status(404).set('X-Robots-Tag', seo.robots).type('html').send(renderTemplate(templates['not-found'], {
      PAGE_TITLE: seo.title,
      PAGE_DESCRIPTION: seo.description,
      PAGE_ROBOTS: seo.robots,
      CANONICAL_URL: seo.canonicalUrl,
      PAGE_URL: seo.pageUrl,
      OG_TYPE: seo.ogType,
      OG_IMAGE_URL: seo.imageUrl,
      OG_IMAGE_ALT: seo.imageAlt,
      STRUCTURED_DATA_BLOCK: seo.structuredDataBlock,
      BRAND_MARK: brand.mark,
      BRAND_NAME: brand.name,
      STYLESHEET_PATH: withBasePath(config, '/assets/main.css'),
      HOME_PATH: withBasePath(config, '/'),
      APP_CONFIG_JSON: serializeForScript(buildClientConfig(requestLike)),
      PAGE_DATA_JSON: serializeForScript({}),
      CURRENT_YEAR: new Date().getFullYear()
    }));
  }

  function sendProblem(response, statusCode, code, message, details = {}) {
    response.status(statusCode).json({
      ok: false,
      code,
      message,
      ...details
    });
  }

  async function healthHandler(request, response) {
    const health = await repository.ping();

    response.set('X-Robots-Tag', 'noindex, nofollow, noarchive').status(health.ok ? 200 : 503).json({
      ok: health.ok,
      database: health.database,
      basePath: config.basePath || '/',
      environment: config.environment,
      timestamp: new Date().toISOString()
    });
  }

  function robotsHandler(request, response) {
    const sitemapUrl = buildAbsoluteUrl(config, request, '/sitemap.xml');
    const lines = [
      'User-agent: *',
      `Allow: ${withBasePath(config, '/')}`,
      `Allow: ${withBasePath(config, '/assets/')}`,
      `Disallow: ${withBasePath(config, '/api/')}`,
      `Disallow: ${withBasePath(config, '/health')}`
    ];

    if (config.basePath) {
      lines.push('Disallow: /health');
    }

    lines.push('', `Sitemap: ${sitemapUrl}`);

    response.type('text/plain').send(lines.join('\n'));
  }

  function sitemapHandler(request, response) {
    const homeUrl = buildAbsoluteUrl(config, request, '/');
    const sitemap = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      '  <url>',
      `    <loc>${homeUrl}</loc>`,
      '    <changefreq>weekly</changefreq>',
      '    <priority>1.0</priority>',
      '  </url>',
      '</urlset>'
    ].join('\n');

    response.type('application/xml').send(sitemap);
  }

  function socialCardHandler(request, response) {
    const homepageUrl = buildAbsoluteUrl(config, request, '/');
    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title desc">
  <title id="title">${brand.name}</title>
  <desc id="desc">Send a URL from your phone to another device instantly.</desc>
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="55%" stop-color="#115e59"/>
      <stop offset="100%" stop-color="#0ea5e9"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.75" cy="0.15" r="0.7">
      <stop offset="0%" stop-color="#f8fafc" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#f8fafc" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)" rx="32"/>
  <rect width="1200" height="630" fill="url(#glow)" rx="32"/>
  <rect x="72" y="72" width="1056" height="486" rx="28" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.18)"/>
  <rect x="96" y="102" width="110" height="110" rx="28" fill="#f8fafc" fill-opacity="0.16"/>
  <text x="151" y="170" text-anchor="middle" font-family="Sora, Arial, sans-serif" font-size="42" font-weight="700" fill="#f8fafc">${brand.mark}</text>
  <text x="96" y="286" font-family="Sora, Arial, sans-serif" font-size="72" font-weight="700" fill="#f8fafc">${brand.name}</text>
  <text x="96" y="356" font-family="Sora, Arial, sans-serif" font-size="34" fill="#dbeafe">Send URLs from your phone to another device</text>
  <text x="96" y="404" font-family="Sora, Arial, sans-serif" font-size="34" fill="#dbeafe">instantly with a QR code and no login.</text>
  <text x="96" y="500" font-family="IBM Plex Mono, monospace" font-size="24" fill="#bfdbfe">${homepageUrl}</text>
</svg>`;

    response.type('image/svg+xml').send(svg.trim());
  }

  async function sessionLookupHandler(request, response) {
    try {
      response.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
      const token = validateToken(request.params.token);
      const session = await repository.getSessionByToken(token);

      if (!session) {
        return sendProblem(response, 404, 'SESSION_NOT_FOUND', 'This session token does not exist.');
      }

      if (isExpiredSession(session)) {
        await repository.markExpired(token);
        return sendProblem(response, 410, 'SESSION_EXPIRED', 'This session has expired. Generate a new QR code on the display.');
      }

      if (!session.displaySocketId) {
        return sendProblem(response, 409, 'DISPLAY_OFFLINE', 'The display session is no longer connected.');
      }

      return response.json({
        ok: true,
        session: {
          token: session.token,
          status: session.status,
          expiresAt: session.expiresAt ? session.expiresAt.toISOString() : null,
          payloadType: session.payloadType,
          hasActiveDisplay: Boolean(session.displaySocketId)
        }
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        return sendProblem(response, 400, error.code, error.message);
      }

      console.error('Failed to look up session:', error);
      return sendProblem(response, 500, 'SESSION_LOOKUP_FAILED', 'Unable to verify the session right now.');
    }
  }

  async function relayHandler(request, response) {
    try {
      response.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
      const token = validateToken(request.body.token);
      const normalizedUrl = normalizeUrl(request.body.url);
      const session = await repository.getSessionByToken(token);

      if (!session) {
        return sendProblem(response, 404, 'SESSION_NOT_FOUND', 'This session token does not exist.');
      }

      if (isExpiredSession(session)) {
        await repository.markExpired(token);
        return sendProblem(response, 410, 'SESSION_EXPIRED', 'This session has expired. Generate a new QR code on the display.');
      }

      if (!session.displaySocketId) {
        return sendProblem(response, 409, 'DISPLAY_OFFLINE', 'The display session is offline. Refresh the display and try again.');
      }

      const updatedSession = await repository.saveUrlDelivery(token, normalizedUrl);

      io.to(session.displaySocketId).emit('relay:deliver', {
        token,
        url: normalizedUrl,
        deliveredAt: updatedSession && updatedSession.deliveredAt
          ? updatedSession.deliveredAt.toISOString()
          : new Date().toISOString()
      });

      return response.json({
        ok: true,
        token,
        url: normalizedUrl,
        message: 'The display is redirecting now.'
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        return sendProblem(response, 400, error.code, error.message);
      }

      console.error('Failed to relay URL:', error);
      return sendProblem(response, 500, 'RELAY_FAILED', 'Unable to deliver the URL right now.');
    }
  }

  const router = express.Router();
  router.use('/assets', express.static(path.join(config.rootDir, 'public', 'assets'), {
    maxAge: config.isProduction ? '1h' : 0
  }));
  router.get('/robots.txt', robotsHandler);
  router.get('/sitemap.xml', sitemapHandler);
  router.get('/social-card.svg', socialCardHandler);

  router.get('/', (request, response) => {
    renderPage(response, 'display', request, {}, {
      title: `${brand.name} | Send URLs Across Devices`,
      description: 'Sendline lets you send a URL from your phone to another device instantly by scanning a QR code.',
      pagePath: '/',
      structuredDataFactory: createHomeStructuredData,
      scriptName: 'display.js'
    });
  });

  router.get('/connect', (request, response) => {
    renderPage(response, 'connect', request, {
      token: request.query.token ? String(request.query.token).trim() : ''
    }, {
      title: `${brand.name} | Send a URL`,
      canonicalPath: '/connect',
      description: 'Paste a URL on your phone and Sendline opens it on the other device linked to this session.',
      pagePath: '/connect',
      robots: 'noindex, follow, noarchive',
      scriptName: 'connect.js'
    });
  });

  router.get('/scan', (request, response) => {
    renderPage(response, 'connect', request, {
      token: request.query.token ? String(request.query.token).trim() : ''
    }, {
      title: `${brand.name} | Open the Sender`,
      canonicalPath: '/scan',
      description: 'Open Sendline with a session code and send a URL to another device.',
      pagePath: '/scan',
      robots: 'noindex, follow, noarchive',
      scriptName: 'connect.js'
    });
  });

  router.get('/health', healthHandler);
  router.get('/api/session/:token', sessionLookupHandler);
  router.post('/api/relay', relayHandler);

  if (config.basePath) {
    app.get('/robots.txt', robotsHandler);
    app.get('/sitemap.xml', sitemapHandler);
    app.get('/', (request, response) => {
      response.redirect(withBasePath(config, '/'));
    });
    app.get('/health', healthHandler);
    app.use(config.basePath, router);
  } else {
    app.use(router);
  }

  app.use((request, response) => {
    renderNotFoundPage(response, request);
  });

  async function buildMobileUrl(requestLike, token) {
    const origin = resolvePublicOrigin(config, requestLike);
    const mobileUrl = new URL(withBasePath(config, '/connect'), `${origin}/`);
    mobileUrl.searchParams.set('token', token);
    return mobileUrl.toString();
  }

  async function createDisplaySession(socket) {
    if (socket.data.sessionToken) {
      await repository.invalidateSession(socket.data.sessionToken);
    }

    const session = await repository.createSession({
      displaySocketId: socket.id,
      ttlMinutes: config.sessionTtlMinutes
    });
    const mobileUrl = await buildMobileUrl(socket.handshake, session.token);
    const qrCodeDataUrl = await QRCode.toDataURL(mobileUrl, {
      width: 360,
      margin: 1,
      color: {
        dark: '#0f172a',
        light: '#f8fafc'
      }
    });

    socket.data.sessionToken = session.token;

    socket.emit('session:ready', {
      token: session.token,
      mobileUrl,
      qrCodeDataUrl,
      expiresAt: session.expiresAt.toISOString()
    });
  }

  io.on('connection', (socket) => {
    socket.on('display:register', async () => {
      try {
        await createDisplaySession(socket);
      } catch (error) {
        console.error('Failed to create display session:', error);
        socket.emit('session:error', {
          message: 'A new access code could not be created right now. Please refresh and try again.'
        });
      }
    });

    socket.on('display:refresh', async () => {
      try {
        await createDisplaySession(socket);
      } catch (error) {
        console.error('Failed to refresh display session:', error);
        socket.emit('session:error', {
          message: 'A fresh access code could not be created right now.'
        });
      }
    });

    socket.on('disconnect', async () => {
      if (!socket.data.sessionToken) {
        return;
      }

      try {
        await repository.markDisplayDisconnected(socket.data.sessionToken);
      } catch (error) {
        console.error('Failed to mark session offline:', error);
      }
    });
  });

  async function close() {
    clearInterval(cleanupTimer);
    io.removeAllListeners();
    await new Promise((resolve) => {
      server.close(resolve);
    });
    await repository.close();
  }

  return {
    app,
    close,
    io,
    server
  };
}

module.exports = {
  createApp
};
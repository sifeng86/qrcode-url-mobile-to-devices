const path = require('path');
const http = require('http');

const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const { resolvePublicOrigin, withBasePath } = require('./config');
const { loadTemplates, renderTemplate } = require('./render');
const { createSessionRepository } = require('./repository');
const { createStorageService, StorageUnavailableError } = require('./storage');
const {
  normalizeNoteText,
  normalizeShareType,
  normalizeUrl,
  validateFileMetadata,
  validateRetentionMinutes,
  validateShareId,
  validateToken,
  ValidationError
} = require('./validation');

const brand = {
  mark: 'SL',
  name: 'Sendline'
};

const shareCard = {
  alt: 'Sendline preview card for temporary sharing across devices',
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
        'Send links, notes, or temporary files from your phone to another device.',
        'Keep file downloads short-lived with configurable expiration and cleanup.'
      ],
      image: imageUrl,
      name: brand.name,
      operatingSystem: 'Any',
      url: canonicalUrl
    },
    {
      '@context': 'https://schema.org',
      '@type': 'HowTo',
      description,
      image: imageUrl,
      inLanguage: 'en',
      name: `How to send a share from your phone to another device with ${brand.name}`,
      step: [
        {
          '@type': 'HowToStep',
          name: 'Open the receiver screen',
          text: `Open ${brand.name} on the device that should receive the next share.`
        },
        {
          '@type': 'HowToStep',
          name: 'Scan the QR code',
          text: 'Use your phone or tablet to scan the QR code and open the sender page.'
        },
        {
          '@type': 'HowToStep',
          name: 'Choose what to send',
          text: 'Send a link, a note, or a temporary file to the other device.'
        }
      ],
      supply: [
        {
          '@type': 'HowToSupply',
          name: 'A phone or tablet with a browser'
        },
        {
          '@type': 'HowToSupply',
          name: 'Another device with a browser'
        }
      ],
      totalTime: 'PT1M'
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Do I need to sign up or install an app?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: `${brand.name} runs in the browser and does not require sign-up, login, or app installation.`
          }
        },
        {
          '@type': 'Question',
          name: 'What can I send?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: `${brand.name} can send links, short notes, and temporary file deliveries when file storage is configured.`
          }
        },
        {
          '@type': 'Question',
          name: 'Do shared files expire?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. File shares use configurable retention and are deleted after expiry by the cleanup worker.'
          }
        }
      ]
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

function isExpiredShareItem(shareItem) {
  return Boolean(shareItem && shareItem.availableUntil && shareItem.availableUntil.getTime() <= Date.now());
}

function wait(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function createRateLimiter({ windowMs, maxRequests, code, message }) {
  const hitMap = new Map();
  const cleanupTimer = setInterval(() => {
    const now = Date.now();

    for (const [key, entry] of hitMap.entries()) {
      if (entry.resetAt <= now) {
        hitMap.delete(key);
      }
    }
  }, Math.max(windowMs, 15000));
  cleanupTimer.unref();

  return (request, response, next) => {
    const key = `${request.ip || request.socket.remoteAddress || 'unknown'}:${request.path}`;
    const now = Date.now();
    const entry = hitMap.get(key);

    if (!entry || entry.resetAt <= now) {
      hitMap.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (entry.count >= maxRequests) {
      response.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return response.status(429).json({
        ok: false,
        code,
        message
      });
    }

    entry.count += 1;
    return next();
  };
}

function createAvailableUntil(retentionMinutes) {
  return new Date(Date.now() + (retentionMinutes * 60 * 1000));
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : null;
}

function buildShareDownloadPath(config, shareItem) {
  const params = new URLSearchParams({ token: shareItem.sessionToken });
  return `${withBasePath(config, `/api/shares/${shareItem.id}/download`)}?${params.toString()}`;
}

function buildShareSummary(config, shareItem) {
  const payload = shareItem.payloadJson || {};
  const expired = isExpiredShareItem(shareItem) || ['expired', 'deleted'].includes(shareItem.status);
  const summary = {
    id: shareItem.id,
    shareType: shareItem.shareType,
    status: expired && shareItem.status === 'delivered' ? 'expired' : shareItem.status,
    availableUntil: toIso(shareItem.availableUntil),
    createdAt: toIso(shareItem.createdAt),
    firstDownloadedAt: toIso(shareItem.firstDownloadedAt),
    isExpired: expired
  };

  if (shareItem.shareType === 'note') {
    return {
      ...summary,
      text: payload.text || '',
      preview: String(payload.text || '').slice(0, 180)
    };
  }

  if (shareItem.shareType === 'file') {
    return {
      ...summary,
      contentType: shareItem.contentType || payload.contentType || 'application/octet-stream',
      downloadPath: expired || shareItem.status !== 'delivered'
        ? null
        : buildShareDownloadPath(config, shareItem),
      fileName: shareItem.originalFilename || payload.fileName || 'download.bin',
      fileSize: shareItem.fileSize || payload.fileSize || null
    };
  }

  return {
    ...summary,
    url: payload.url || null
  };
}

function buildVisibleShares(config, shareItems) {
  return shareItems
    .filter((shareItem) => shareItem.status !== 'pending_upload')
    .map((shareItem) => buildShareSummary(config, shareItem));
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
  const storage = createStorageService(config);
  const templates = loadTemplates(config.rootDir);
  const shareMutationLimiter = createRateLimiter({
    windowMs: 60000,
    maxRequests: 24,
    code: 'RATE_LIMITED',
    message: 'Too many share requests have been sent. Try again in a moment.'
  });
  const fileDownloadLimiter = createRateLimiter({
    windowMs: 60000,
    maxRequests: 60,
    code: 'DOWNLOAD_RATE_LIMITED',
    message: 'Too many download requests have been made. Try again in a moment.'
  });

  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '128kb' }));
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

  const cleanupTimer = setInterval(async () => {
    try {
      await repository.expireReadyShareItems();

      if (storage.isReady()) {
        const expiredFileShares = await repository.findExpiredFileSharesForDeletion();

        for (const shareItem of expiredFileShares) {
          try {
            await storage.deleteObject(shareItem.objectKey);
            await repository.markShareDeleted(shareItem.id);
          } catch (error) {
            console.error(`Failed to delete expired file share ${shareItem.id}:`, error.message);
          }
        }
      }

      await repository.cleanupExpiredSessions();
    } catch (error) {
      console.error('Failed to cleanup expired data:', error.message);
    }
  }, config.cleanupIntervalMs);
  cleanupTimer.unref();

  function buildClientConfig(requestLike) {
    return {
      basePath: config.basePath,
      publicAppUrl: `${resolvePublicOrigin(config, requestLike)}${config.basePath}`,
      shareTypes: ['link', 'note', 'file'],
      socketPath: config.socketPath,
      storage: {
        enabled: storage.isReady(),
        maxFileBytes: config.storage.maxFileBytes,
        defaultRetentionMinutes: config.storage.defaultRetentionMinutes,
        minRetentionMinutes: config.storage.minRetentionMinutes,
        maxRetentionMinutes: config.storage.maxRetentionMinutes,
        retentionOptions: config.storage.retentionOptions,
        downloadUrlTtlSeconds: config.storage.downloadUrlTtlSeconds
      },
      routes: {
        home: withBasePath(config, '/'),
        connect: withBasePath(config, '/connect'),
        session: withBasePath(config, '/api/session'),
        relay: withBasePath(config, '/api/relay'),
        sessionShares: withBasePath(config, '/api/session'),
        filePrepare: withBasePath(config, '/api/files/prepare'),
        fileFinalize: withBasePath(config, '/api/files/finalize'),
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

  async function resolveSession(token, response, { requireActiveDisplay = false } = {}) {
    const session = await repository.getSessionByToken(token);

    if (!session) {
      sendProblem(response, 404, 'SESSION_NOT_FOUND', 'This session token does not exist.');
      return null;
    }

    if (isExpiredSession(session)) {
      await repository.markExpired(token);
      sendProblem(response, 410, 'SESSION_EXPIRED', 'This session has expired. Generate a new QR code on the display.');
      return null;
    }

    if (requireActiveDisplay && !session.displaySocketId) {
      sendProblem(response, 409, 'DISPLAY_OFFLINE', 'The display session is offline. Refresh the display and try again.');
      return null;
    }

    return session;
  }

  async function resolveShareItem(token, shareId, response) {
    const shareItem = await repository.getShareItemById(shareId);

    if (!shareItem || shareItem.sessionToken !== token) {
      sendProblem(response, 404, 'SHARE_NOT_FOUND', 'This share item does not exist.');
      return null;
    }

    if (isExpiredShareItem(shareItem) && shareItem.status !== 'deleted') {
      await repository.markShareExpired(shareId);
      sendProblem(response, 410, 'SHARE_EXPIRED', 'This share is no longer available.');
      return null;
    }

    if (shareItem.status === 'deleted') {
      sendProblem(response, 410, 'SHARE_DELETED', 'This share is no longer available.');
      return null;
    }

    return shareItem;
  }

  async function healthHandler(request, response) {
    const health = await repository.ping();

    response.set('X-Robots-Tag', 'noindex, nofollow, noarchive').status(health.ok ? 200 : 503).json({
      ok: health.ok,
      database: health.database,
      storage: {
        driver: config.storage.driver,
        enabled: storage.isReady(),
        bucketConfigured: Boolean(config.storage.r2.bucketName)
      },
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
  <desc id="desc">Share links, notes, and temporary files across devices.</desc>
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
  <text x="96" y="356" font-family="Sora, Arial, sans-serif" font-size="34" fill="#dbeafe">Send links, notes, and temporary files</text>
  <text x="96" y="404" font-family="Sora, Arial, sans-serif" font-size="34" fill="#dbeafe">from your phone to another device.</text>
  <text x="96" y="500" font-family="IBM Plex Mono, monospace" font-size="24" fill="#bfdbfe">${homepageUrl}</text>
</svg>`;

    response.type('image/svg+xml').send(svg.trim());
  }

  async function sessionLookupHandler(request, response) {
    try {
      response.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
      const token = validateToken(request.params.token);
      const session = await resolveSession(token, response, { requireActiveDisplay: true });

      if (!session) {
        return;
      }

      return response.json({
        ok: true,
        session: {
          token: session.token,
          status: session.status,
          expiresAt: toIso(session.expiresAt),
          payloadType: session.payloadType,
          hasActiveDisplay: Boolean(session.displaySocketId),
          storageEnabled: storage.isReady()
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

  async function sessionSharesHandler(request, response) {
    try {
      response.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
      const token = validateToken(request.params.token);
      const session = await resolveSession(token, response);

      if (!session) {
        return;
      }

      const shareItems = await repository.listSharesBySessionToken(token, 24);
      return response.json({
        ok: true,
        shares: buildVisibleShares(config, shareItems)
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        return sendProblem(response, 400, error.code, error.message);
      }

      console.error('Failed to list shares:', error);
      return sendProblem(response, 500, 'SHARE_LIST_FAILED', 'Unable to load recent shares right now.');
    }
  }

  async function relayHandler(request, response) {
    try {
      response.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
      const token = validateToken(request.body.token);
      const shareType = normalizeShareType(request.body.shareType || (request.body.text ? 'note' : 'link'));
      const retentionMinutes = validateRetentionMinutes(request.body.retentionMinutes, config.storage);
      const session = await resolveSession(token, response, { requireActiveDisplay: true });

      if (!session) {
        return;
      }

      const availableUntil = createAvailableUntil(retentionMinutes);
      let shareItem;
      let payloadJson;
      let message;

      if (shareType === 'note') {
        payloadJson = { text: normalizeNoteText(request.body.text) };
        shareItem = await repository.createShareItem({
          sessionToken: token,
          shareType: 'note',
          payloadJson,
          availableUntil
        });
        await repository.saveSessionDelivery(token, {
          payloadType: 'note',
          payloadJson
        });
        message = 'The note is ready on the receiver.';
      } else {
        payloadJson = { url: normalizeUrl(request.body.url) };
        shareItem = await repository.createShareItem({
          sessionToken: token,
          shareType: 'link',
          payloadJson,
          availableUntil
        });
        await repository.saveSessionDelivery(token, {
          targetUrl: payloadJson.url,
          payloadType: 'link',
          payloadJson
        });
        message = 'The link is ready on the receiver.';
      }

      const shareSummary = buildShareSummary(config, shareItem);
      io.to(session.displaySocketId).emit('share:received', shareSummary);

      return response.json({
        ok: true,
        message,
        share: shareSummary,
        url: shareSummary.url || null
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        return sendProblem(response, 400, error.code, error.message);
      }

      console.error('Failed to deliver share:', error);
      return sendProblem(response, 500, 'RELAY_FAILED', 'Unable to deliver this share right now.');
    }
  }

  async function prepareFileHandler(request, response) {
    try {
      response.set('X-Robots-Tag', 'noindex, nofollow, noarchive');

      if (!storage.isReady()) {
        return sendProblem(response, 503, 'FILE_STORAGE_UNAVAILABLE', 'File sharing is not configured on this server yet.');
      }

      const token = validateToken(request.body.token);
      const session = await resolveSession(token, response, { requireActiveDisplay: true });

      if (!session) {
        return;
      }

      const retentionMinutes = validateRetentionMinutes(request.body.retentionMinutes, config.storage);
      const fileMetadata = validateFileMetadata(request.body, config.storage);
      const objectKey = storage.createObjectKey(token, fileMetadata.fileName);
      const uploadPlan = await storage.createUploadPlan({
        objectKey,
        contentType: fileMetadata.contentType
      });
      const availableUntil = createAvailableUntil(retentionMinutes);
      const shareItem = await repository.createShareItem({
        sessionToken: token,
        shareType: 'file',
        status: 'pending_upload',
        payloadJson: {
          fileName: fileMetadata.fileName,
          contentType: fileMetadata.contentType,
          fileSize: fileMetadata.fileSize
        },
        objectKey,
        originalFilename: fileMetadata.fileName,
        contentType: fileMetadata.contentType,
        fileSize: fileMetadata.fileSize,
        availableUntil
      });

      return response.json({
        ok: true,
        shareId: shareItem.id,
        share: buildShareSummary(config, shareItem),
        upload: {
          url: uploadPlan.url,
          method: uploadPlan.method,
          headers: uploadPlan.headers,
          expiresAt: toIso(uploadPlan.expiresAt)
        }
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        return sendProblem(response, 400, error.code, error.message);
      }

      if (error instanceof StorageUnavailableError) {
        return sendProblem(response, 503, 'FILE_STORAGE_UNAVAILABLE', error.message);
      }

      console.error('Failed to prepare file upload:', error);
      return sendProblem(response, 500, 'FILE_PREPARE_FAILED', 'Unable to prepare this file upload right now.');
    }
  }

  async function finalizeFileHandler(request, response) {
    try {
      response.set('X-Robots-Tag', 'noindex, nofollow, noarchive');

      if (!storage.isReady()) {
        return sendProblem(response, 503, 'FILE_STORAGE_UNAVAILABLE', 'File sharing is not configured on this server yet.');
      }

      const token = validateToken(request.body.token);
      const shareId = validateShareId(request.body.shareId);
      const session = await resolveSession(token, response, { requireActiveDisplay: true });

      if (!session) {
        return;
      }

      const shareItem = await resolveShareItem(token, shareId, response);

      if (!shareItem) {
        return;
      }

      if (shareItem.shareType !== 'file') {
        return sendProblem(response, 400, 'INVALID_SHARE_TYPE', 'This share item is not a file upload.');
      }

      if (shareItem.status === 'delivered') {
        return response.json({
          ok: true,
          message: 'This file has already been finalized.',
          share: buildShareSummary(config, shareItem)
        });
      }

      if (shareItem.status !== 'pending_upload') {
        return sendProblem(response, 409, 'UPLOAD_STATE_INVALID', 'This file upload can no longer be finalized.');
      }

      try {
        await storage.ensureObjectReady({
          objectKey: shareItem.objectKey,
          fileSize: shareItem.fileSize,
          contentType: shareItem.contentType
        });
      } catch (error) {
        return sendProblem(response, 409, 'UPLOAD_NOT_READY', error.message || 'The uploaded file could not be verified yet.');
      }

      const payloadJson = {
        fileName: shareItem.originalFilename,
        contentType: shareItem.contentType,
        fileSize: shareItem.fileSize
      };
      const deliveredShare = await repository.markShareDelivered(shareItem.id, payloadJson);
      await repository.saveSessionDelivery(token, {
        payloadType: 'file',
        payloadJson: {
          shareId: deliveredShare.id,
          ...payloadJson
        }
      });

      const shareSummary = buildShareSummary(config, deliveredShare);
      io.to(session.displaySocketId).emit('share:received', shareSummary);

      return response.json({
        ok: true,
        message: 'The file is ready on the receiver.',
        share: shareSummary
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        return sendProblem(response, 400, error.code, error.message);
      }

      if (error instanceof StorageUnavailableError) {
        return sendProblem(response, 503, 'FILE_STORAGE_UNAVAILABLE', error.message);
      }

      console.error('Failed to finalize file upload:', error);
      return sendProblem(response, 500, 'FILE_FINALIZE_FAILED', 'Unable to finalize this file upload right now.');
    }
  }

  async function downloadShareHandler(request, response) {
    try {
      response.set('X-Robots-Tag', 'noindex, nofollow, noarchive');

      if (!storage.isReady()) {
        return sendProblem(response, 503, 'FILE_STORAGE_UNAVAILABLE', 'File sharing is not configured on this server yet.');
      }

      const token = validateToken(request.query.token);
      const shareId = validateShareId(request.params.shareId);
      const shareItem = await resolveShareItem(token, shareId, response);

      if (!shareItem) {
        return;
      }

      if (shareItem.shareType !== 'file') {
        return sendProblem(response, 400, 'INVALID_SHARE_TYPE', 'Only file shares can be downloaded from this endpoint.');
      }

      if (shareItem.status !== 'delivered') {
        return sendProblem(response, 410, 'SHARE_UNAVAILABLE', 'This file is no longer available.');
      }

      const downloadPlan = await storage.createDownloadUrl({
        objectKey: shareItem.objectKey,
        fileName: shareItem.originalFilename,
        contentType: shareItem.contentType
      });

      await repository.markShareDownloaded(shareId);
      return response.redirect(downloadPlan.url);
    } catch (error) {
      if (error instanceof ValidationError) {
        return sendProblem(response, 400, error.code, error.message);
      }

      if (error instanceof StorageUnavailableError) {
        return sendProblem(response, 503, 'FILE_STORAGE_UNAVAILABLE', error.message);
      }

      console.error('Failed to create download URL:', error);
      return sendProblem(response, 500, 'DOWNLOAD_FAILED', 'Unable to prepare this download right now.');
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
      title: `${brand.name} | Share Across Devices`,
      description: 'Send links, notes, and temporary files from your phone to another device with a QR code.',
      pagePath: '/',
      structuredDataFactory: createHomeStructuredData,
      scriptName: 'display.js'
    });
  });

  router.get('/connect', (request, response) => {
    renderPage(response, 'connect', request, {
      token: request.query.token ? String(request.query.token).trim() : '',
      shareType: request.query.type ? String(request.query.type).trim() : 'link'
    }, {
      title: `${brand.name} | Send a Share`,
      canonicalPath: '/connect',
      description: 'Choose a link, note, or file on your phone and send it to the connected receiver.',
      pagePath: '/connect',
      robots: 'noindex, follow, noarchive',
      scriptName: 'connect.js'
    });
  });

  router.get('/scan', (request, response) => {
    renderPage(response, 'connect', request, {
      token: request.query.token ? String(request.query.token).trim() : '',
      shareType: request.query.type ? String(request.query.type).trim() : 'link'
    }, {
      title: `${brand.name} | Open the Sender`,
      canonicalPath: '/scan',
      description: 'Open Sendline with a session code and send a link, note, or temporary file to another device.',
      pagePath: '/scan',
      robots: 'noindex, follow, noarchive',
      scriptName: 'connect.js'
    });
  });

  router.get('/health', healthHandler);
  router.get('/api/session/:token', sessionLookupHandler);
  router.get('/api/session/:token/shares', sessionSharesHandler);
  router.post('/api/relay', shareMutationLimiter, relayHandler);
  router.post('/api/files/prepare', shareMutationLimiter, prepareFileHandler);
  router.post('/api/files/finalize', shareMutationLimiter, finalizeFileHandler);
  router.get('/api/shares/:shareId/download', fileDownloadLimiter, downloadShareHandler);

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
const crypto = require('crypto');

const {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

class StorageUnavailableError extends Error {
  constructor(message = 'File storage is not configured.') {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

function sanitizeFileName(fileName) {
  return String(fileName || '')
    .trim()
    .replace(/[\\/]+/g, '_')
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .slice(0, 120);
}

function createObjectKey(sessionToken, fileName) {
  const safeFileName = sanitizeFileName(fileName) || 'share.bin';
  const randomSuffix = crypto.randomBytes(8).toString('hex');
  return `shares/${sessionToken}/${Date.now()}-${randomSuffix}-${safeFileName}`;
}

function createDisabledStorageService(config) {
  return {
    config,
    createDownloadUrl() {
      throw new StorageUnavailableError();
    },
    async createUploadPlan() {
      throw new StorageUnavailableError();
    },
    createObjectKey,
    async deleteObject() {
      return { deleted: false, skipped: true };
    },
    async ensureObjectReady() {
      throw new StorageUnavailableError();
    },
    async uploadObject() {
      throw new StorageUnavailableError();
    },
    isReady() {
      return false;
    }
  };
}

function createR2StorageService(config) {
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.storage.r2.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.storage.r2.accessKeyId,
      secretAccessKey: config.storage.r2.secretAccessKey
    }
  });

  async function createUploadPlan({ objectKey, contentType }) {
    const expiresIn = config.storage.uploadUrlTtlSeconds;
    const uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: config.storage.r2.bucketName,
        Key: objectKey,
        ContentType: contentType
      }),
      { expiresIn }
    );

    return {
      expiresAt: new Date(Date.now() + (expiresIn * 1000)),
      headers: {
        'Content-Type': contentType
      },
      method: 'PUT',
      url: uploadUrl
    };
  }

  async function ensureObjectReady({ objectKey, fileSize, contentType }) {
    const result = await client.send(new HeadObjectCommand({
      Bucket: config.storage.r2.bucketName,
      Key: objectKey
    }));

    const actualSize = Number(result.ContentLength || 0);
    const actualContentType = result.ContentType || 'application/octet-stream';

    if (fileSize && actualSize !== fileSize) {
      throw new Error('Uploaded file size does not match the prepared metadata.');
    }

    if (contentType && actualContentType !== contentType) {
      throw new Error('Uploaded file type does not match the prepared metadata.');
    }

    return {
      contentLength: actualSize,
      contentType: actualContentType,
      etag: result.ETag || null
    };
  }

  async function createDownloadUrl({ objectKey, fileName, contentType }) {
    const expiresIn = config.storage.downloadUrlTtlSeconds;
    const encodedFileName = encodeURIComponent(fileName || 'download.bin');
    const downloadUrl = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: config.storage.r2.bucketName,
        Key: objectKey,
        ResponseContentDisposition: `attachment; filename*=UTF-8''${encodedFileName}`,
        ResponseContentType: contentType || 'application/octet-stream'
      }),
      { expiresIn }
    );

    return {
      expiresAt: new Date(Date.now() + (expiresIn * 1000)),
      url: downloadUrl
    };
  }

  async function uploadObject({ objectKey, contentType, body, contentLength }) {
    await client.send(new PutObjectCommand({
      Bucket: config.storage.r2.bucketName,
      Key: objectKey,
      Body: body,
      ContentLength: contentLength,
      ContentType: contentType || 'application/octet-stream'
    }));

    return { uploaded: true };
  }

  async function deleteObject(objectKey) {
    await client.send(new DeleteObjectCommand({
      Bucket: config.storage.r2.bucketName,
      Key: objectKey
    }));

    return { deleted: true, skipped: false };
  }

  return {
    config,
    createDownloadUrl,
    createObjectKey,
    createUploadPlan,
    deleteObject,
    ensureObjectReady,
    uploadObject,
    isReady() {
      return true;
    }
  };
}

function createStorageService(config) {
  if (!config.storage.enabled) {
    return createDisabledStorageService(config);
  }

  return createR2StorageService(config);
}

module.exports = {
  StorageUnavailableError,
  createObjectKey,
  createStorageService
};
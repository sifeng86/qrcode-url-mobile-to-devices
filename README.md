# Sendline

Sendline is a QR-based temporary share hub. It lets you open a receiver page on one device, scan a QR code on your phone, and send a link, note, or temporary file to the other device in real time.

## Why this refactor exists

The original sample worked, but it relied on hardcoded IPs, mixed technologies, and minimal UI. This version focuses on three goals:

- Docker-first local setup with optional remote database support.
- Environment-driven public URL and base-path switching for different deployment targets.
- Cleaner architecture and stronger UX while keeping the original scan, paste, and send flow.

## Core features

- Real-time QR handoff from phone to another device using Socket.IO.
- Link and short-note delivery to a receiver inbox.
- Optional temporary file delivery backed by Cloudflare R2 with short-lived download access.
- Configurable share lifetime for all share types, with cleanup support for expired file objects.
- Clean Node/Express-only runtime. The old PHP bridge is removed.
- Default Docker Compose startup with MySQL included.
- Optional `PUBLIC_BASE_URL` and `BASE_PATH` support so QR links can move across domains, IPs, ports, and subpaths.
- Session validation, URL validation, file metadata validation, expiry handling, and clearer error states.
- SEO-ready rendering with canonical URLs, Open Graph tags, robots rules, and sitemap output.
- UI redesigned for a receiver inbox and a mobile share composer.

## Architecture

- `server.js`: startup entrypoint.
- `src/app.js`: Express routes, Socket.IO events, page rendering, and orchestration.
- `src/repository.js`: MySQL session persistence.
- `src/config.js`: environment parsing and route/public URL helpers.
- `src/storage.js`: Cloudflare R2 presigned upload/download handling.
- `src/validation.js`: token and URL validation.
- `templates/`: HTML templates for the display page, mobile page, and fallback states.
- `public/assets/`: CSS and browser-side scripts.

The persistence model is intentionally more generic than the original prototype so share history, downloadable assets, and richer payload metadata can be added without reworking the whole app.

## Quick start

### Option 1: simplest local startup

1. Ensure Docker Desktop is running.
2. Start the app and bundled MySQL:

```bash
docker compose up -d --build
```

3. Open the display page:

```text
http://localhost:8080/
```

4. Scan the QR code with your phone or open the generated mobile link.
5. Paste a URL and submit it. The display page should redirect immediately.

Stop the stack with:

```bash
docker compose down
```

If you want to remove the local database volume too:

```bash
docker compose down -v
```

Important: this mode builds the files into the Docker image. If you edit files such as `templates/display.html`, `templates/connect.html`, `public/assets/main.css`, or files in `src/`, you must rebuild the app container before the changes appear:

```bash
docker compose up -d --build
```

### Option 1B: live-edit Docker development mode

Use this mode when you want template, CSS, and server-side changes to take effect while you are editing.

1. Start the stack with the development override:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

2. Edit files in any of these folders:

- `templates/`
- `public/`
- `src/`
- `server.js`

3. Refresh the browser after each change.

In this mode, the app container bind-mounts your local files and runs `nodemon`, so server-side template changes and frontend asset changes are reloaded automatically.

Stop it with:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
```

### Option 2: run with a remote MySQL database

1. Copy the example environment file if needed.
2. Update these variables:

- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `DB_TABLE`

3. Start only the application container and skip the bundled database:

```bash
docker compose up -d --build app --no-deps
```

If your app is exposed behind a reverse proxy or public domain, also set `PUBLIC_BASE_URL`. If it is mounted under a subpath, set `BASE_PATH` as well.

### Optional: enable temporary file sharing with Cloudflare R2

File sharing is disabled until the R2 settings below are configured.

1. Create an R2 bucket for temporary uploads.
2. Create R2 API credentials with access to that bucket.
3. Configure bucket CORS so browser `PUT` uploads from your app origin are allowed.
4. Set these variables before starting the app:

- `FILE_STORAGE_DRIVER=r2`
- `R2_ACCOUNT_ID`
- `R2_BUCKET_NAME`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

If you use Docker Compose, place these values in `.env`. The compose app service now passes them through to the container automatically.

#### Cloudflare dashboard walkthrough

Use this checklist if you want to know exactly where each value comes from.

1. Log in to the Cloudflare dashboard and open your account.
2. Go to `R2 Object Storage`.
3. Create a bucket.
4. Create an API token for that bucket.
5. Add a bucket CORS policy.
6. Copy the values into `.env` and rebuild the app.

Important limitation for the current app:

- This app currently uses the standard R2 endpoint format `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` from [src/storage.js](d:/Projects/qrcode-url-mobile-to-devices/src/storage.js).
- Because of that, use a bucket in the default jurisdiction for now. Do not use an EU-only or FedRAMP-only bucket unless you also add endpoint configuration support in the app.

#### Where each variable comes from

| Variable | What to put here | Where to get it in Cloudflare |
| --- | --- | --- |
| `FILE_STORAGE_DRIVER` | `r2` | You set this yourself in `.env` to enable the R2 driver. |
| `R2_ACCOUNT_ID` | Your Cloudflare account ID | Cloudflare dashboard -> choose the account -> the account ID is shown in account details. Cloudflare documents this as the ID used in the R2 S3 endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`. |
| `R2_BUCKET_NAME` | The exact R2 bucket name | Cloudflare dashboard -> `R2 Object Storage` -> your bucket list -> copy the bucket name you created. |
| `R2_ACCESS_KEY_ID` | The R2 Access Key ID | Cloudflare dashboard -> `R2 Object Storage` -> `Manage` next to `API Tokens` -> create an R2 token -> copy the displayed `Access Key ID` value. Cloudflare may also refer to this as `Client ID`. |
| `R2_SECRET_ACCESS_KEY` | The R2 Secret Access Key | Shown only once immediately after token creation in the same R2 token flow. Cloudflare may also refer to this as `Client Secret`. Copy it immediately and store it safely. |

#### Step 1: create the bucket

1. In Cloudflare, open `R2 Object Storage`.
2. Select `Create bucket`.
3. Enter a bucket name. This exact value becomes `R2_BUCKET_NAME`.
4. Keep the bucket in the default jurisdiction for this app.

Recommended bucket naming for this project:

- `sendline-temp`
- `sendline-uploads`

#### Step 2: create API credentials

Cloudflare's official R2 authentication flow is:

1. Open `R2 Object Storage`.
2. Under `Account Details`, select `Manage` next to `API Tokens`.
3. Choose one of these:

- `Create User API token`: simpler for personal development.
- `Create Account API token`: better if this project is owned by the Cloudflare account rather than one person. Only Super Administrators can create or view these.

4. Choose permissions.

For this app, the practical minimum is:

- `Object Read & Write` scoped to the one bucket used by Sendline.

That gives the app enough access to:

- upload objects,
- check uploaded objects,
- create downloads,
- delete expired objects.

5. Create the token.
6. Copy both values shown at the end:

- `Access Key ID` -> use as `R2_ACCESS_KEY_ID`
- `Secret Access Key` -> use as `R2_SECRET_ACCESS_KEY`

Important:

- Cloudflare only shows the `Secret Access Key` once.
- If you lose it, create a new token instead of trying to recover the old secret.

#### Step 3: find the account ID

Cloudflare documents that the R2 S3 API endpoint is:

```text
https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

So `R2_ACCOUNT_ID` is the Cloudflare account ID, not the bucket ID and not the token ID.

To get it:

1. Stay in the same Cloudflare account.
2. Open the account details area in the dashboard.
3. Copy the account ID.

#### Step 4: put the values into `.env`

Example:

```dotenv
FILE_STORAGE_DRIVER=r2
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_BUCKET_NAME=sendline-temp
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
```

You will usually also want these defaults at the same time:

```dotenv
FILE_UPLOAD_URL_TTL_SECONDS=300
FILE_DOWNLOAD_URL_TTL_SECONDS=60
FILE_RETENTION_MINUTES=60
FILE_RETENTION_MIN_MINUTES=5
FILE_RETENTION_MAX_MINUTES=1440
FILE_MAX_BYTES=26214400
```

#### Step 5: add bucket CORS in the Cloudflare dashboard

Cloudflare's dashboard path is:

1. `R2 Object Storage`
2. Select your bucket
3. `Settings`
4. `CORS Policy`
5. `Add CORS policy`
6. Open the `JSON` tab
7. Paste the policy and save

Recommended defaults for the first rollout:

- `FILE_UPLOAD_URL_TTL_SECONDS=300`
- `FILE_DOWNLOAD_URL_TTL_SECONDS=60`
- `FILE_RETENTION_MINUTES=60`
- `FILE_RETENTION_MIN_MINUTES=5`
- `FILE_RETENTION_MAX_MINUTES=1440`
- `FILE_MAX_BYTES=26214400`

Recommended R2 bucket CORS policy for browser-based presigned uploads:

```json
[
	{
		"AllowedOrigins": [
			"http://localhost:8080",
			"https://share.example.com"
		],
		"AllowedMethods": ["GET", "PUT", "HEAD"],
		"AllowedHeaders": ["Content-Type"],
		"ExposeHeaders": ["ETag", "Content-Length"],
		"MaxAgeSeconds": 3600
	}
]
```

Important notes:

- `AllowedOrigins` must be exact origins only, such as `http://localhost:8080` or `https://share.example.com`. Do not include a path like `/connect` or a trailing slash.
- `PUT` is required for browser uploads to the presigned URL.
- `GET` is useful for browser-side access and future debugging checks.
- `HEAD` is safe to include and aligns with object metadata checks.
- If you change the bucket CORS policy on a live domain, allow a short propagation window before retesting.

#### Step 6: rebuild and verify

After `.env` is updated, rebuild the app:

```bash
docker compose up -d --build
```

Then check runtime health:

```bash
curl http://localhost:8080/health
```

You want to see this in the response:

```json
"storage": {
	"enabled": true
}
```

#### Common mistakes

- Using the zone ID instead of the account ID.
- Creating the bucket in a non-default jurisdiction even though the app currently uses only the standard R2 endpoint.
- Forgetting to save the `Secret Access Key` when Cloudflare shows it.
- Adding `/connect` or another path into `AllowedOrigins`.
- Updating `.env` but forgetting to rebuild the Docker container.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `APP_PORT` | No | Host port published by Docker Compose. The container still listens on `8080`. |
| `PUBLIC_BASE_URL` | No | Optional public origin used for QR links, such as `https://demo.example.com`. Leave blank to derive from the incoming request. |
| `BASE_PATH` | No | Optional deployment subpath, such as `/sent-url`. |
| `SESSION_TTL_MINUTES` | No | Session lifetime before the token expires. |
| `FILE_STORAGE_DRIVER` | No | Set to `r2` to enable temporary file sharing. Default is disabled until R2 credentials are present. |
| `FILE_MAX_BYTES` | No | Maximum file size accepted by the temporary file flow. |
| `FILE_RETENTION_MINUTES` | No | Default lifetime for new shares. |
| `FILE_RETENTION_MIN_MINUTES` | No | Minimum allowed share lifetime in minutes. |
| `FILE_RETENTION_MAX_MINUTES` | No | Maximum allowed share lifetime in minutes. |
| `FILE_UPLOAD_URL_TTL_SECONDS` | No | Lifetime of a presigned direct-upload URL. |
| `FILE_DOWNLOAD_URL_TTL_SECONDS` | No | Lifetime of a presigned download URL created on demand. |
| `DB_HOST` | Yes | MySQL host. Defaults to the bundled `db` service for local Docker startup. |
| `DB_PORT` | No | MySQL port. Default is `3306`. |
| `DB_USER` | Yes | MySQL user. |
| `DB_PASSWORD` | Yes | MySQL password. |
| `DB_NAME` | Yes | MySQL database name. |
| `DB_TABLE` | No | Session table name. Default is `relay_sessions`. |
| `DB_SHARE_TABLE` | No | Share item table name. Default is `share_items`. |
| `DB_CONNECT_RETRIES` | No | Startup retry count while waiting for MySQL. |
| `DB_CONNECT_RETRY_MS` | No | Delay between startup retry attempts. |
| `R2_ACCOUNT_ID` | No | Cloudflare account ID used for the R2 S3 endpoint. Required for file sharing. |
| `R2_BUCKET_NAME` | No | Bucket name used for temporary file objects. Required for file sharing. |
| `R2_ACCESS_KEY_ID` | No | R2 API access key for presigned upload/download generation. Required for file sharing. |
| `R2_SECRET_ACCESS_KEY` | No | R2 API secret key for presigned upload/download generation. Required for file sharing. |

For bundled local MySQL, these values also matter:

- `MYSQL_ROOT_PASSWORD`
- `MYSQL_DATABASE`
- `MYSQL_USER`
- `MYSQL_PASSWORD`

## Local development without Docker

1. Install dependencies:

```bash
npm install
```

2. Ensure a MySQL database exists and matches the schema in `init.sql`.
3. Create or update `.env`.
4. Start the server in watch mode:

```bash
npm run dev
```

Or start it once without file watching:

```bash
npm start
```

5. Open `http://localhost:8080/`.

## R2 verification flow

Use this checklist after you configure the R2 variables.

1. Copy `.env.example` to `.env` if needed, then fill in `FILE_STORAGE_DRIVER=r2` and the `R2_*` credentials.
2. Start or rebuild the stack:

```bash
docker compose up -d --build
```

3. Confirm the runtime sees storage enabled:

```bash
curl http://localhost:8080/health
```

You should see `"storage": { "enabled": true, ... }` in the JSON response.

4. Open the receiver page, scan the QR code, choose `File`, and upload a small test file.
5. Confirm the receiver inbox shows the file card and the download works.
6. For a quick expiry test, temporarily lower the retention window and cleanup interval in `.env`, rebuild, then verify the file eventually shows as expired and the app logs do not report deletion failures.

Useful temporary values for a short expiry test:

- `FILE_RETENTION_MIN_MINUTES=1`
- `FILE_RETENTION_MINUTES=1`
- `FILE_RETENTION_MAX_MINUTES=10`
- `CLEANUP_INTERVAL_MS=15000`

When debugging upload failures, inspect the browser network tab first. The most common cause is an R2 CORS rule that does not exactly match your app origin.

## Verification checklist

- Open the display page and confirm a token and QR code appear.
- Open the mobile page and verify the token is accepted.
- Send a valid `http` or `https` URL and confirm it appears in the receiver inbox.
- Send a short note and confirm it appears in the receiver inbox.
- If R2 is configured, upload a file and confirm the receiver can download it before expiry.
- Submit an invalid token or invalid URL and confirm the UI shows a controlled error.
- Change `BASE_PATH` and confirm routes and QR links still work.
- Change `PUBLIC_BASE_URL` and confirm generated QR links reflect the new public host.

## Future upgrades already considered

- Manual revoke for file shares can be added on top of the current share-item model.
- Device naming and recent share history can be added without splitting the app by feature.
- The UI is designed so more actions, status states, and session metadata can be added without a full redesign.

## Testing

Run the lightweight unit regression tests with:

```bash
npm test
```

Run the live end-to-end flow against a running app with:

```bash
npm run test:e2e
```

If you want both unit and integration suites in one command, use:

```bash
npm run test:all
```

## License

MIT

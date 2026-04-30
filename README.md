# Sendline

Sendline is a QR-based URL sender. It lets you open a receiver page on one device, scan a QR code on your phone, paste a URL, and open that URL on the other device in real time.

## Why this refactor exists

The original sample worked, but it relied on hardcoded IPs, mixed technologies, and minimal UI. This version focuses on three goals:

- Docker-first local setup with optional remote database support.
- Environment-driven public URL and base-path switching for different deployment targets.
- Cleaner architecture and stronger UX while keeping the original scan, paste, and send flow.

## Core features

- Real-time QR handoff from phone to another device using Socket.IO.
- Clean Node/Express-only runtime. The old PHP bridge is removed.
- Default Docker Compose startup with MySQL included.
- Optional `PUBLIC_BASE_URL` and `BASE_PATH` support so QR links can move across domains, IPs, ports, and subpaths.
- Session validation, URL validation, expiry handling, and clearer error states.
- SEO-ready rendering with canonical URLs, Open Graph tags, robots rules, and sitemap output.
- UI redesigned for receiver screens and mobile submission.

## Architecture

- `server.js`: startup entrypoint.
- `src/app.js`: Express routes, Socket.IO events, page rendering, and orchestration.
- `src/repository.js`: MySQL session persistence.
- `src/config.js`: environment parsing and route/public URL helpers.
- `src/validation.js`: token and URL validation.
- `templates/`: HTML templates for the display page, mobile page, and fallback states.
- `public/assets/`: CSS and browser-side scripts.

The persistence model is intentionally more generic than the original prototype so future transfer types, such as downloadable assets or richer payload metadata, can be added without reworking the whole app.

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

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `APP_PORT` | No | Host port published by Docker Compose. The container still listens on `8080`. |
| `PUBLIC_BASE_URL` | No | Optional public origin used for QR links, such as `https://demo.example.com`. Leave blank to derive from the incoming request. |
| `BASE_PATH` | No | Optional deployment subpath, such as `/sent-url`. |
| `SESSION_TTL_MINUTES` | No | Session lifetime before the token expires. |
| `DB_HOST` | Yes | MySQL host. Defaults to the bundled `db` service for local Docker startup. |
| `DB_PORT` | No | MySQL port. Default is `3306`. |
| `DB_USER` | Yes | MySQL user. |
| `DB_PASSWORD` | Yes | MySQL password. |
| `DB_NAME` | Yes | MySQL database name. |
| `DB_TABLE` | No | Session table name. Default is `relay_sessions`. |
| `DB_CONNECT_RETRIES` | No | Startup retry count while waiting for MySQL. |
| `DB_CONNECT_RETRY_MS` | No | Delay between startup retry attempts. |

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

## Verification checklist

- Open the display page and confirm a token and QR code appear.
- Open the mobile page and verify the token is accepted.
- Submit a valid `http` or `https` URL and confirm the display redirects.
- Submit an invalid token or invalid URL and confirm the UI shows a controlled error.
- Change `BASE_PATH` and confirm routes and QR links still work.
- Change `PUBLIC_BASE_URL` and confirm generated QR links reflect the new public host.

## Future upgrades already considered

- Downloadable file handoff can be added on top of the generic session model.
- The repository and payload structure can evolve into richer transfer types without splitting the app by feature.
- The UI is designed so more actions, status states, and session metadata can be added without a full redesign.

## Testing

Run the lightweight regression tests with:

```bash
npm test
```

## License

MIT

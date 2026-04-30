# Docker Notes

The main usage guide now lives in `README.md`. This file keeps the Docker-specific shortcuts in one place.

## Default local stack

Start the app and bundled MySQL:

```bash
docker compose up -d --build
```

Open:

```text
http://localhost:8080/
```

Stop:

```bash
docker compose down
```

Reset the database volume too:

```bash
docker compose down -v
```

This mode copies project files into the Docker image. If you change files like `templates/display.html`, `templates/connect.html`, `public/assets/main.css`, or anything under `src/`, rebuild the app container:

```bash
docker compose up -d --build
```

## Live-edit development mode

When you want local file edits to take effect without rebuilding on every change, use the development override:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

This mode:

- bind-mounts the workspace into the container
- runs `nodemon`
- reloads changes from `templates/`, `public/`, `src/`, and `server.js`

Stop it with:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
```

## Remote database mode

If you already have MySQL elsewhere, update `.env` or your deployment environment with remote `DB_*` values, then run only the app service:

```bash
docker compose up -d --build app --no-deps
```

## Public URL and base path

- Leave `PUBLIC_BASE_URL` blank to derive QR links from the current request origin.
- Set `PUBLIC_BASE_URL=https://your-domain.example` when the app is behind a public domain or reverse proxy.
- Set `BASE_PATH=/sent-url` if the app is mounted under a subpath.

## Useful commands

Show logs:

```bash
docker compose logs -f app
```

Check health endpoint:

```bash
curl http://localhost:8080/health
```

## Schema

The bundled MySQL container loads `init.sql` automatically. If you use a remote database, run the same schema there before starting the app.

# SX CONVERTER

GitHub-ready, Docker-based file conversion platform with a mobile-first dark glass/neon UI and a real Node.js backend.

## Render deployment

Use a **Web Service**, not a Static Site.

The repository root must contain:
- `Dockerfile`
- `package.json`
- `index.html`
- `server/`
- `public/`

### Recommended Render settings

- Runtime / Language: **Docker**
- Dockerfile Path: `./Dockerfile`
- Docker Command: leave blank (the Dockerfile CMD starts the server)
- Health Check Path: `/api/health`
- `PORT`: `10000`

Render supports Dockerfiles and requires the web process to listen on `0.0.0.0`. This project explicitly does that.

The included `render.yaml` can be used as the deployment configuration.

## Android APK builds

The Docker image installs:
- OpenJDK 17
- Android command-line tools
- Android platform 35
- Android build-tools 35.0.0
- Gradle 8.10.2

HTML → APK and ZIP → APK therefore have an actual Android build pipeline instead of changing a file extension.

APK generation is compute-heavy. For reliable production use, use a Render plan with enough CPU/RAM/disk for Android/Gradle builds. Render's free/low-resource instances can be unsuitable for heavy APK compilation.

## Storage

Render's default filesystem is ephemeral. Generated files only need to survive long enough for the immediate download in this architecture. For persistent uploads/outputs across restarts, attach a Render persistent disk and set `DATA_DIR` to its mount path.

## Important conversion truthfulness

The six public formats are PDF, HTML, APK, ZIP, DOCX and TXT. The API accepts arbitrary pairs, but it does **not** fake conversions where no reliable source-to-target transformation exists.

Implemented real pipelines include:
- HTML → APK
- ZIP → APK
- APK → HTML (when recoverable HTML exists)
- APK → ZIP
- ZIP → HTML
- HTML/TXT/DOCX document conversions using real engines where applicable
- HTML/TXT/DOCX/PDF → ZIP as genuine archiving

Some PDF layout-reconstruction routes intentionally fail rather than produce misleading output. These can be enabled later with a dedicated PDF rendering/text/OCR engine.

## Local run

```bash
npm install
npm start
```

Open `http://localhost:10000`.

## API

- `GET /api/health`
- `GET /api/formats`
- `POST /api/upload`
- `POST /api/convert`
- `GET /api/conversion/:id`
- `GET /api/download/:id`
- `DELETE /api/conversion/:id`

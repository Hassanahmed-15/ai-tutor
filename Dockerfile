# syntax=docker/dockerfile:1

###############################################################################
# ARIA Live Tutor — production container
#
# Built as a multi-stage image so the thing you actually ship contains no build
# toolchain, no dev dependencies, and no source: just Node, the runtime Python
# stackZ the PDF pipeline needs, and Next's standalone server bundle.
#
# Why the whole repo is the build context rather than frontend/web:
#   frontend/web depends on four local workspace packages (@aria/grounding,
#   @aria/lesson-graph, @aria/modality-lenses, @aria/tutor-reasoning), so npm
#   must see the root package.json, the lockfile, and backend/packages/* to
#   resolve them. Building from frontend/web alone fails at install time.
###############################################################################

# ─── Stage 1: install dependencies ───────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# Native modules (@resvg/resvg-js, @napi-rs/canvas) ship prebuilt binaries but
# need a compiler present if a prebuild is missing for this platform.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy only manifests first so this layer caches: dependencies are reinstalled
# only when a package.json or the lockfile actually changes, not on every source
# edit. This is the difference between a 20-second and a 4-minute rebuild.
COPY package.json package-lock.json ./
COPY frontend/web/package.json ./frontend/web/
COPY backend/packages ./backend/packages

# `npm ci` (not `install`) so the build is reproducible from the lockfile and
# fails loudly if the lockfile is out of sync rather than silently resolving
# different versions than you tested with.
# The trailing installs are deliberate. Tailwind v4 pulls in TWO native toolchains — lightningcss
# and @tailwindcss/oxide — and each ships its real binary as a per-platform optional dependency.
# npm skips those often enough that it cannot be relied on, and the failure surfaces only at build
# time, as `Cannot find module '@tailwindcss/oxide-linux-x64-gnu'` or a missing .node binding. It
# is invisible locally, because the Mac's arm64 binary installed fine.
#
# Installing the META-packages (not a hardcoded -linux-x64-gnu) lets npm resolve whichever platform
# binary matches the machine doing the build — arm64 on an Apple Silicon Mac, x64 on Azure's
# builders — so the same Dockerfile works in both places.
RUN npm ci --workspaces --include-workspace-root --include=optional && \
    npm install --no-save --force lightningcss @tailwindcss/oxide

# ─── Stage 2: build the Next app ─────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Client-side feature flags are inlined at build time by Next, so any NEXT_PUBLIC_*
# value must be present HERE — setting it only at runtime silently has no effect.
# These mirror the defaults in .env.example; override with --build-arg.
ARG NEXT_PUBLIC_REACT_ANIMATIONS_ENABLED=1
ARG NEXT_PUBLIC_BLACKBOARD_GEN_ENABLED=1
ARG NEXT_PUBLIC_GEMINI_LIVE_ENABLED=1
# The live tutor's own gate. LessonPlayer reads NEXT_PUBLIC_REALTIME_TUTOR_ENABLED, so without
# this the voice tutor is silently OFF in the deployed build while working locally — the flag is
# inlined by Next at build time, which is why it has to be an ARG here rather than a runtime env.
ARG NEXT_PUBLIC_REALTIME_TUTOR_ENABLED=1
ENV NEXT_PUBLIC_REACT_ANIMATIONS_ENABLED=$NEXT_PUBLIC_REACT_ANIMATIONS_ENABLED
ENV NEXT_PUBLIC_BLACKBOARD_GEN_ENABLED=$NEXT_PUBLIC_BLACKBOARD_GEN_ENABLED
ENV NEXT_PUBLIC_GEMINI_LIVE_ENABLED=$NEXT_PUBLIC_GEMINI_LIVE_ENABLED
ENV NEXT_PUBLIC_REALTIME_TUTOR_ENABLED=$NEXT_PUBLIC_REALTIME_TUTOR_ENABLED

WORKDIR /app/frontend/web
RUN npm run build

# ─── Stage 3: runtime ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app

# Runtime system dependencies:
#   python3 + pip        — the PDF figure-cropping pipeline (scripts/pdf_pipeline.py)
#   tesseract-ocr        — pytesseract's actual OCR engine; the Python package is
#                          only a wrapper and fails without the binary
#   libgl1 / libglib2.0  — OpenCV needs these even in the headless build
#   fonts-liberation     — otherwise server-rendered SVG/PDF text falls back to
#                          notdef boxes, which silently corrupts exported boards
#   fonts-crosextra-*    — metric-compatible stand-ins for Calibri and Cambria, which real decks
#   fonts-dejavu-core      overwhelmingly use. Without them LibreOffice renders a converted deck in
#                          whatever it can find: production came back in a MONOSPACE face with the
#                          letters visibly spaced out, while the same deck was correct locally.
#                          Liberation only covers Arial/Times/Courier, so it does not help here.
#   libreoffice-impress  — converts an uploaded .pptx to PDF so slides go through the SAME
#                          rasteriser a paper does (lib/pptxToPdf.ts). Composing slides from
#                          their XML cannot reproduce themes, masters, SmartArt or native
#                          charts — PowerPoint draws those itself. Absent, the app degrades to
#                          that composed preview, so a broken install costs fidelity not uploads.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv \
      tesseract-ocr \
      libgl1 libglib2.0-0 \
      fonts-liberation \
      fonts-crosextra-carlito fonts-crosextra-caladea \
      fonts-dejavu-core \
      libreoffice-impress \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install the Python stack into a venv. Debian's Python is "externally managed"
# and refuses global pip installs; a venv is the supported way and keeps the
# image reproducible.
COPY frontend/web/scripts/requirements-pdf.txt /tmp/requirements-pdf.txt
RUN python3 -m venv /opt/pdfenv \
    && /opt/pdfenv/bin/pip install --no-cache-dir -r /tmp/requirements-pdf.txt \
    && rm /tmp/requirements-pdf.txt
# The app shells out to this interpreter by name.
ENV PDF_PYTHON_BINARY=/opt/pdfenv/bin/python3

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as a non-root user. A container that runs as root gives an attacker who
# finds an RCE the run of the filesystem; this costs nothing to avoid.
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

# Next's standalone output already contains the minimal node_modules it needs,
# so nothing else is copied from the build stage.
COPY --from=builder --chown=nextjs:nodejs /app/frontend/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/frontend/web/.next/static ./frontend/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/frontend/web/public ./frontend/web/public
# outputFileTracingIncludes carries the Python script into standalone, but copy
# it explicitly so a tracing change can never silently break PDF uploads.
COPY --from=builder --chown=nextjs:nodejs /app/frontend/web/scripts ./frontend/web/scripts

USER nextjs
EXPOSE 3000

# Container Apps also probes /api/health; this HEALTHCHECK makes `docker run`
# and other platforms report the same status.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "frontend/web/server.js"]

# Zammad Ticket Copier - Firefox & Chrome Extension

Intelligently extract and export Zammad ticket conversations for analysis, archival, and AI processing.

## Overview

A lightweight browser extension for Firefox and Chrome that extracts entire support ticket conversations from Zammad helpdesk systems. Export as formatted text or structured JSON for use with AI tools, data pipelines, and knowledge management systems.

**Perfect for:**
- Support teams needing quick ticket archives
- Analysts processing support data
- Building knowledge bases from conversations
- AI-powered ticket analysis and summarization
- Custom automation workflows

## Features

- **One-Click Extraction** - Copy full ticket transcripts instantly
- **Smart Content Cleaning** - Removes signatures, disclaimers, and farewell markers automatically
- **Structured JSON Export** - Download tickets in machine-readable format
- **AI-Ready Format** - Perfect for Perplexity, ChatGPT, Claude, and similar tools
- **User-Controlled Permissions** - You decide which Zammad instances to grant access to
- **Zero Data Collection** - Privacy-first: no tracking, no external servers
- **Firefox Developer Edition Compatible** - Full support for development workflows

## Installation

Build first: `npm install && npm run build`.

### Firefox (temporary loading)
1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `build/firefox/manifest.json`

### Chrome / Edge
1. Go to `chrome://extensions` and enable Developer mode
2. Click "Load unpacked"
3. Select `build/chrome/`

### For Development

One source tree, two browsers:

```
src/extract.js            extraction, runs inside the Zammad page (shared)
src/background.js         Firefox MV2 background: injects extract.js as code
src/popup.*, icons        shared
src/browser-shim.js       maps `browser` to `chrome` where it is missing
src-chrome/service_worker.js  Chrome MV3: chrome.scripting.executeScript(func)
manifests/base.json       shared manifest keys
manifests/firefox.json    Manifest V2, Gecko ID
manifests/chrome.json     Manifest V3, scripting permission
```

```bash
npm run build          # build/<browser>/ and dist/zammad-ticket-extractor-<browser>-<version>.zip
npm run lint:firefox   # web-ext lint on build/firefox
npm run check:chrome   # loads build/chrome in headless Chromium
```

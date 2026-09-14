# Third-Party Notices and Licenses

Path incorporates open-source software, native libraries, and precompiled binaries. This document summarizes their respective licenses and attribution notices.

---

## Bundled Native Binaries & Runtimes

### whisper.cpp

- **Homepage:** https://github.com/ggerganov/whisper.cpp
- **Location:** `apps/desktop/vendor/whisper/win32-x64/Release/`
- **License:** MIT License

```text
Copyright (c) 2023-2026 The ggml authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

### FFmpeg (via ffmpeg-static)

- **Homepage:** https://ffmpeg.org / https://github.com/eugeneware/ffmpeg-static
- **License:** GNU Lesser General Public License (LGPL) version 2.1 or later / GNU General Public License (GPL) version 2 or later
- **Notice:** FFmpeg is an open-source multimedia framework. Path utilizes FFmpeg binaries distributed through `ffmpeg-static` for audio/video conversion and muxing. Source code for FFmpeg is available at https://ffmpeg.org.

---

### uiohook-napi / libuiohook

- **Homepage:** https://github.com/tolik-puntsyk/uiohook-napi / https://github.com/kwhat/libuiohook
- **License:** Apache License 2.0 / GNU LGPL v3 / MIT
- **Notice:** Used for global mouse and keyboard event hook tracking during screen recording sessions.

---

### better-sqlite3

- **Homepage:** https://github.com/WiseLibs/better-sqlite3
- **License:** MIT License
- **Notice:** SQLite3 database bindings for local metadata and transaction management.

---

## Key Open Source Libraries

| Library       | License    | Usage                                     |
| ------------- | ---------- | ----------------------------------------- |
| Electron      | MIT        | Desktop runtime and window orchestration  |
| Next.js       | MIT        | Application interface and renderer export |
| React         | MIT        | UI component architecture                 |
| Redux Toolkit | MIT        | Renderer state management                 |
| Drizzle ORM   | Apache-2.0 | Type-safe database queries and migrations |
| Zod           | MIT        | Strict IPC payload schema validation      |
| Lucide React  | ISC        | Icon set                                  |
| Radix UI      | MIT        | Accessible UI primitives                  |
| Tailwind CSS  | MIT        | Utility-first styling framework           |
| Vitest        | MIT        | Unit and integration testing              |
| Prettier      | MIT        | Code formatting                           |
| ESLint        | MIT        | Linting and code quality                  |

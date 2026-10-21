# Photo Search

Search your own photos with natural language — "a dog on the beach", "red car at night" — using
**CLIP** embeddings computed **entirely on your device**. Nothing is uploaded; your library and its
index are stored locally and survive reloads.

## Features

- Drop in many photos at once; each is embedded with CLIP and indexed locally.
- Type a text query to rank photos by semantic similarity, with a live match-% badge per result.
- **Persistent**: photos and their embedding vectors are cached in IndexedDB, so re-opening the app
  restores your library instantly (no re-embedding).
- Remove individual photos or clear the whole library.
- Runs on **WebGPU** with a WASM/CPU fallback; a device badge shows which is active.

## Tech stack

- **React 18 + TypeScript + Vite**, Tailwind CSS, framer-motion
- **@huggingface/transformers** (transformers.js v3) — `Xenova/clip-vit-base-patch32`
- **Web Worker** for embedding; **IndexedDB** for persistence

## How it works

```
Images ──▶ Web Worker (clip.worker.ts) ──▶ CLIP vision encoder ──▶ 512-d vector (L2-normalized)
Query  ──▶ Web Worker                  ──▶ CLIP text encoder   ──▶ 512-d vector
Rank   ──▶ cosine similarity (dot product, since vectors are normalized) ──▶ sorted grid
Store  ──▶ IndexedDB { key, name, blob, vector }
```

- The worker loads separate CLIP **vision** and **text** projection models and L2-normalizes every
  embedding, so ranking is a simple dot product on the main thread (fast for hundreds of photos).
- `src/lib/db.ts` is a tiny IndexedDB wrapper. The cache key is a content signature
  (`name-size-lastModified`) so the same file is never embedded twice.
- Embeddings are transferred from the worker as `ArrayBuffer`s to avoid copies.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5175
npm run build
```

The CLIP model downloads from the Hugging Face Hub on first run (needs network), then is cached.

## Project structure

```
src/
  App.tsx                  # dropzone, grid, search, ranking, persistence
  hooks/useClip.ts         # owns the worker; embedImage / embedText + cosine()
  worker/
    protocol.ts            # typed message protocol
    clip.worker.ts         # CLIP vision + text embedding
  components/Dropzone.tsx  # multi-file drag-and-drop
  lib/db.ts                # IndexedDB cache (photos + vectors)
  lib/cn.ts
```

## Notes

- All embedding and search is local; images never leave the browser.
- Search quality is as good as CLIP ViT-B/32 — great for scenes, objects, colors, and moods.
- First load downloads the model; subsequent loads are fast thanks to browser + IndexedDB caching.

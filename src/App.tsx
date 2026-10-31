import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Dropzone } from '@/components/Dropzone'
import { useClip, cosine } from '@/hooks/useClip'
import {
  clearPhotos,
  deletePhoto,
  fileKey,
  getAllPhotos,
  putPhoto,
  type PhotoRecord,
} from '@/lib/db'
import { cn } from '@/lib/cn'

interface Photo {
  key: string
  name: string
  url: string
  vector: Float32Array
}

interface Indexing {
  done: number
  total: number
}

export default function App() {
  const { state, embedImage, embedText } = useClip()
  const [photos, setPhotos] = useState<Photo[]>([])
  const [query, setQuery] = useState('')
  const [scores, setScores] = useState<Map<string, number> | null>(null)
  const [indexing, setIndexing] = useState<Indexing | null>(null)
  const [loadedCache, setLoadedCache] = useState(false)
  const urlsRef = useRef<Set<string>>(new Set())

  // Load any previously-indexed photos from IndexedDB on first render.
  useEffect(() => {
    getAllPhotos()
      .then((records: PhotoRecord[]) => {
        const restored = records.map((r) => {
          const url = URL.createObjectURL(r.blob)
          urlsRef.current.add(url)
          return { key: r.key, name: r.name, url, vector: r.vector }
        })
        setPhotos(restored)
      })
      .finally(() => setLoadedCache(true))
    return () => {
      for (const url of urlsRef.current) URL.revokeObjectURL(url)
    }
  }, [])

  const addFiles = useCallback(
    async (files: File[]) => {
      const existing = new Set(photos.map((p) => p.key))
      const fresh = files.filter((f) => !existing.has(fileKey(f)))
      if (!fresh.length) return

      setIndexing({ done: 0, total: fresh.length })
      for (let i = 0; i < fresh.length; i++) {
        const file = fresh[i]
        const key = fileKey(file)
        try {
          const vector = await embedImage(key, file)
          await putPhoto({ key, name: file.name, blob: file, vector })
          const url = URL.createObjectURL(file)
          setPhotos((prev) => {
            if (prev.some((p) => p.key === key)) {
              // Already present: drop the just-created URL so it doesn't leak.
              URL.revokeObjectURL(url)
              return prev
            }
            urlsRef.current.add(url)
            return [...prev, { key, name: file.name, url, vector }]
          })
        } catch {
          // Skip a file that fails to embed; keep indexing the rest.
        }
        setIndexing({ done: i + 1, total: fresh.length })
      }
      setIndexing(null)
    },
    [photos, embedImage],
  )

  // Re-rank whenever the (debounced) query or the photo set changes.
  useEffect(() => {
    const q = query.trim()
    if (!q || photos.length === 0) {
      setScores(null)
      return
    }
    let cancelled = false
    const handle = setTimeout(() => {
      embedText(q)
        .then((qv) => {
          if (cancelled) return
          const m = new Map<string, number>()
          for (const p of photos) m.set(p.key, cosine(qv, p.vector))
          setScores(m)
        })
        .catch(() => !cancelled && setScores(null))
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [query, photos, embedText])

  const ordered = useMemo(() => {
    if (!scores) return photos
    return [...photos].sort((a, b) => (scores.get(b.key) ?? 0) - (scores.get(a.key) ?? 0))
  }, [photos, scores])

  const removePhoto = useCallback((key: string) => {
    setPhotos((prev) => {
      const target = prev.find((p) => p.key === key)
      if (target) {
        URL.revokeObjectURL(target.url)
        urlsRef.current.delete(target.url)
      }
      return prev.filter((p) => p.key !== key)
    })
    void deletePhoto(key)
  }, [])

  const clearAll = useCallback(() => {
    for (const url of urlsRef.current) URL.revokeObjectURL(url)
    urlsRef.current.clear()
    setPhotos([])
    setScores(null)
    setQuery('')
    void clearPhotos()
  }, [])

  const modelLoading = state.phase === 'loading'
  const avgDownload = state.downloads.length
    ? Math.round(state.downloads.reduce((s, d) => s + d.progress, 0) / state.downloads.length)
    : 0

  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col px-6 py-12">
      <header className="mb-6">
        <div className="flex items-center gap-3">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-accent" />
          <span className="font-mono text-xs uppercase tracking-[0.3em] text-zinc-500">
            Photo Search
          </span>
        </div>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
          Find any photo by
          <br />
          <span className="text-accent">describing it.</span>
        </h1>
        <p className="mt-4 max-w-xl text-zinc-400">
          Add your photos, then search with plain language like “a dog on the beach” or “red car at
          night”. CLIP runs entirely on your device — nothing is uploaded.
        </p>
      </header>

      <StatusBar
        phase={state.phase}
        status={state.status}
        device={state.device}
        progress={avgDownload}
        showProgress={modelLoading && state.downloads.length > 0}
      />

      {photos.length > 0 && (
        <div className="mt-6">
          <SearchBar
            value={query}
            onChange={setQuery}
            disabled={modelLoading}
            count={photos.length}
          />
        </div>
      )}

      <main className="mt-6 flex-1">
        {loadedCache && photos.length === 0 ? (
          <Dropzone onFiles={addFiles} disabled={modelLoading} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              <AnimatePresence>
                {ordered.map((p) => (
                  <PhotoCard
                    key={p.key}
                    photo={p}
                    score={scores?.get(p.key)}
                    onRemove={() => removePhoto(p.key)}
                  />
                ))}
              </AnimatePresence>
            </div>
            <div className="mt-4">
              <Dropzone onFiles={addFiles} disabled={modelLoading} compact />
            </div>
          </>
        )}
      </main>

      {(indexing || photos.length > 0) && (
        <footer className="mt-8 flex items-center justify-between font-mono text-[11px] text-zinc-600">
          <span>
            {indexing
              ? `Indexing ${indexing.done} / ${indexing.total}…`
              : `${photos.length} photo${photos.length === 1 ? '' : 's'} indexed · CLIP ViT-B/32`}
          </span>
          {photos.length > 0 && (
            <button type="button" onClick={clearAll} className="hover:text-zinc-300">
              Clear all
            </button>
          )}
        </footer>
      )}

      {state.phase === 'error' && (
        <p className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 font-mono text-sm text-red-300">
          {state.error}
        </p>
      )}
    </div>
  )
}

function SearchBar({
  value,
  onChange,
  disabled,
  count,
}: {
  value: string
  onChange: (v: string) => void
  disabled: boolean
  count: number
}) {
  return (
    <div className="relative">
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Search ${count} photos — e.g. “a cat on a sofa”`}
        className="w-full rounded-xl border border-zinc-700 bg-zinc-900/60 px-4 py-3 pr-10 text-sm outline-none placeholder:text-zinc-500 focus:border-accent"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
          aria-label="Clear search"
        >
          ✕
        </button>
      )}
    </div>
  )
}

function PhotoCard({
  photo,
  score,
  onRemove,
}: {
  photo: Photo
  score?: number
  onRemove: () => void
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 350, damping: 30 }}
      className="group relative aspect-square overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900"
    >
      <img src={photo.url} alt={photo.name} loading="lazy" className="h-full w-full object-cover" />
      {score != null && (
        <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 font-mono text-[10px] text-accent">
          {(score * 100).toFixed(0)}%
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-xs text-zinc-300 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
        aria-label="Remove photo"
      >
        ✕
      </button>
    </motion.div>
  )
}

function StatusBar({
  phase,
  status,
  device,
  progress,
  showProgress,
}: {
  phase: string
  status: string
  device: string | null
  progress: number
  showProgress: boolean
}) {
  const dot =
    phase === 'error' ? 'bg-red-500' : phase === 'ready' ? 'bg-accent' : 'bg-amber-400 animate-pulse'
  return (
    <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
      <span className={cn('h-2 w-2 shrink-0 rounded-full', dot)} />
      <span className="font-mono text-xs text-zinc-400">{status}</span>
      {device && phase === 'ready' && (
        <span className="ml-auto rounded-full border border-zinc-700 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          {device}
        </span>
      )}
      {showProgress && (
        <div className="ml-auto flex items-center gap-2">
          <div className="h-1 w-28 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
          </div>
          <span className="font-mono text-[10px] text-zinc-500">{progress}%</span>
        </div>
      )}
    </div>
  )
}

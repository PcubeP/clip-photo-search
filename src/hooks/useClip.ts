import { useCallback, useEffect, useRef, useState } from 'react'
import type { Device, WorkerResponse } from '@/worker/protocol'

export type Phase = 'loading' | 'ready' | 'error'

export interface ClipState {
  phase: Phase
  device: Device | null
  status: string
  downloads: { file: string; progress: number }[]
  error: string | null
}

const initial: ClipState = {
  phase: 'loading',
  device: null,
  status: 'Starting…',
  downloads: [],
  error: null,
}

export function useClip() {
  const workerRef = useRef<Worker | null>(null)
  const textId = useRef(0)
  const imageResolvers = useRef(new Map<string, (v: Float32Array) => void>())
  const imageRejecters = useRef(new Map<string, (e: Error) => void>())
  const textResolvers = useRef(new Map<number, (v: Float32Array) => void>())
  const textRejecters = useRef(new Map<number, (e: Error) => void>())
  const [state, setState] = useState<ClipState>(initial)

  useEffect(() => {
    const worker = new Worker(new URL('../worker/clip.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data
      switch (msg.type) {
        case 'status':
          setState((s) => ({ ...s, status: msg.message }))
          break
        case 'download':
          setState((s) => {
            const downloads = [...s.downloads]
            const i = downloads.findIndex((d) => d.file === msg.file)
            const entry = { file: msg.file, progress: msg.progress }
            if (i === -1) downloads.push(entry)
            else downloads[i] = entry
            return { ...s, downloads }
          })
          break
        case 'ready':
          setState((s) => ({
            ...s,
            phase: 'ready',
            device: msg.device,
            status: msg.device === 'webgpu' ? 'Ready · GPU accelerated' : 'Ready · CPU (WASM)',
            downloads: [],
          }))
          break
        case 'imageEmbedding': {
          imageResolvers.current.get(msg.id)?.(new Float32Array(msg.vector))
          imageResolvers.current.delete(msg.id)
          imageRejecters.current.delete(msg.id)
          break
        }
        case 'textEmbedding': {
          textResolvers.current.get(msg.id)?.(new Float32Array(msg.vector))
          textResolvers.current.delete(msg.id)
          textRejecters.current.delete(msg.id)
          break
        }
        case 'error': {
          if (typeof msg.id === 'string') {
            imageRejecters.current.get(msg.id)?.(new Error(msg.message))
            imageResolvers.current.delete(msg.id)
            imageRejecters.current.delete(msg.id)
          } else if (typeof msg.id === 'number') {
            textRejecters.current.get(msg.id)?.(new Error(msg.message))
            textResolvers.current.delete(msg.id)
            textRejecters.current.delete(msg.id)
          } else {
            setState((s) => ({ ...s, phase: 'error', error: msg.message }))
          }
          break
        }
      }
    }

    worker.postMessage({ type: 'load' })
    return () => worker.terminate()
  }, [])

  const embedImage = useCallback((id: string, blob: Blob) => {
    const worker = workerRef.current!
    return new Promise<Float32Array>((resolve, reject) => {
      imageResolvers.current.set(id, resolve)
      imageRejecters.current.set(id, reject)
      worker.postMessage({ type: 'embedImage', id, blob })
    })
  }, [])

  const embedText = useCallback((text: string) => {
    const worker = workerRef.current!
    const id = ++textId.current
    return new Promise<Float32Array>((resolve, reject) => {
      textResolvers.current.set(id, resolve)
      textRejecters.current.set(id, reject)
      worker.postMessage({ type: 'embedText', id, text })
    })
  }, [])

  return { state, embedImage, embedText }
}

export function cosine(a: Float32Array, b: Float32Array): number {
  // Vectors are already L2-normalized in the worker, so dot product = cosine.
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

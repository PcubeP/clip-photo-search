/// <reference lib="webworker" />
import {
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  RawImage,
  env,
  type PreTrainedModel,
  type PreTrainedTokenizer,
  type Processor,
} from '@huggingface/transformers'
import type { Device, WorkerRequest, WorkerResponse } from './protocol'

env.allowLocalModels = false

const MODEL_ID = 'Xenova/clip-vit-base-patch32'

let device: Device = 'wasm'
let processor: Processor | null = null
let vision: PreTrainedModel | null = null
let tokenizer: PreTrainedTokenizer | null = null
let text: PreTrainedModel | null = null

function post(message: WorkerResponse, transfer?: Transferable[]) {
  ;(self as DedicatedWorkerGlobalScope).postMessage(message, transfer ?? [])
}

type ProgressEvent = { status: string; file?: string; progress?: number }

function onProgress(event: ProgressEvent) {
  if (event.status === 'progress' && event.file) {
    post({ type: 'download', file: event.file, progress: event.progress ?? 0 })
  }
}

function l2normalize(v: Float32Array): Float32Array {
  let sum = 0
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i]
  const norm = Math.sqrt(sum) || 1
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm
  return out
}

async function loadOn(target: Device) {
  processor = await AutoProcessor.from_pretrained(MODEL_ID, { progress_callback: onProgress })
  tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback: onProgress })
  vision = await CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, {
    device: target,
    progress_callback: onProgress,
  })
  text = await CLIPTextModelWithProjection.from_pretrained(MODEL_ID, {
    device: target,
    progress_callback: onProgress,
  })
}

async function load() {
  post({ type: 'status', message: 'Loading CLIP model…' })
  try {
    await loadOn('webgpu')
    device = 'webgpu'
  } catch {
    post({ type: 'status', message: 'WebGPU unavailable — using CPU (WASM).' })
    await loadOn('wasm')
    device = 'wasm'
  }
  post({ type: 'ready', device })
}

async function embedImage(id: string, blob: Blob) {
  if (!processor || !vision) throw new Error('Model not loaded')
  const url = URL.createObjectURL(blob)
  try {
    const image = await RawImage.fromURL(url)
    const inputs = await processor(image)
    const { image_embeds } = await vision(inputs)
    const vec = l2normalize(image_embeds.data as Float32Array)
    const buffer = vec.buffer as ArrayBuffer
    post({ type: 'imageEmbedding', id, vector: buffer }, [buffer])
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function embedText(id: number, query: string) {
  if (!tokenizer || !text) throw new Error('Model not loaded')
  const inputs = tokenizer([query], { padding: true, truncation: true })
  const { text_embeds } = await text(inputs)
  const vec = l2normalize(text_embeds.data as Float32Array)
  const buffer = vec.buffer as ArrayBuffer
  post({ type: 'textEmbedding', id, vector: buffer }, [buffer])
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data
  if (msg.type === 'load') {
    load().catch((err) => post({ type: 'error', message: String(err?.message ?? err) }))
  } else if (msg.type === 'embedImage') {
    embedImage(msg.id, msg.blob).catch((err) =>
      post({ type: 'error', id: msg.id, message: String(err?.message ?? err) }),
    )
  } else if (msg.type === 'embedText') {
    embedText(msg.id, msg.text).catch((err) =>
      post({ type: 'error', id: msg.id, message: String(err?.message ?? err) }),
    )
  }
})

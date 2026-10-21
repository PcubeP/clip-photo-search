// Message protocol between the UI and the CLIP embedding worker.

export type Device = 'webgpu' | 'wasm'

export type WorkerRequest =
  | { type: 'load' }
  | { type: 'embedImage'; id: string; blob: Blob }
  | { type: 'embedText'; id: number; text: string }

export type WorkerResponse =
  | { type: 'ready'; device: Device }
  | { type: 'download'; file: string; progress: number }
  | { type: 'status'; message: string }
  | { type: 'imageEmbedding'; id: string; vector: ArrayBuffer }
  | { type: 'textEmbedding'; id: number; vector: ArrayBuffer }
  | { type: 'error'; id?: string | number; message: string }

import type { ModelDescriptor } from './model'
import { WorkerBackgroundRemover } from './remover'

/** The WebAssembly runtime file, served from this origin's own media directory like every other file. */
const wasmUrl = '/media/models/ort-wasm-simd-threaded.wasm'

/**
 * The remover the app ships: the cut-out worker (built as its own chunk with the model runtime) and the
 * WebAssembly file (an asset of the build, served from the app's own origin like every other file).
 */
export function createBundledRemover(model: ModelDescriptor): WorkerBackgroundRemover {
  return new WorkerBackgroundRemover(model, {
    createWorker: () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'synkra-cutout' }),
    wasmUrl,
  })
}

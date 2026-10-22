export interface ImageStubOptions {
  width?: number
  height?: number
}

/**
 * Makes image elements load instantly in jsdom with a fixed intrinsic size (jsdom cannot
 * decode images). Every `<img>`/`Image` reports `naturalWidth/naturalHeight` from the stub
 * options and fires `load` right after its `src` is set. Returns a restore function.
 */
export function installImageStub({ width = 10, height = 10 }: ImageStubOptions = {}): () => void {
  const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
  const naturalWidth = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth')
  const naturalHeight = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalHeight')
  if (!srcDescriptor?.get || !srcDescriptor.set) return () => undefined

  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => width })
  Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { configurable: true, get: () => height })
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    enumerable: srcDescriptor.enumerable,
    get: srcDescriptor.get,
    set(value: string) {
      srcDescriptor.set.call(this, value)
      queueMicrotask(() => this.dispatchEvent(new Event('load')))
    },
  })

  return () => {
    if (naturalWidth) Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', naturalWidth)
    else delete (HTMLImageElement.prototype as { naturalWidth?: unknown }).naturalWidth
    if (naturalHeight) Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', naturalHeight)
    else delete (HTMLImageElement.prototype as { naturalHeight?: unknown }).naturalHeight
    Object.defineProperty(HTMLImageElement.prototype, 'src', srcDescriptor)
  }
}

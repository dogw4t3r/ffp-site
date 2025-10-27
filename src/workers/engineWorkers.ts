let modulePromise: Promise<any> | null = null
let Module: any = null
let outBuf: string[] = []

function post(type: string, data: Record<string, unknown> = {}) {
  ;(self as DedicatedWorkerGlobalScope).postMessage({ type, ...data })
}

function normalizeInitPayload(payload: any) {
  if (!payload) return {}
  if (typeof payload === 'string') {
    return { scriptUrl: payload, wasmBinaryUrl: undefined }
  }
  return payload
}

async function ensureModule(initPayload: any) {
  const { scriptUrl, wasmBinaryUrl } = normalizeInitPayload(initPayload)
  if (!scriptUrl) {
    throw new Error('Missing engine script URL')
  }

  if (!modulePromise) {
    modulePromise = (async () => {
      try {
        const factory = (await import(/* @vite-ignore */ scriptUrl)).default
        Module = await factory({
          locateFile: (path: string, prefix?: string) => {
            if (path.endsWith('.wasm')) {
              if (wasmBinaryUrl) return wasmBinaryUrl
              const scriptHref = new URL(scriptUrl, self.location.href)
              return new URL(path, scriptHref).toString()
            }
            if (prefix) {
              try {
                const base = new URL(prefix, scriptUrl)
                return new URL(path, base).toString()
              } catch {
                // fall through to default behaviour
              }
            }
            return path
          },
          print: (txt: unknown) => {
            const line = String(txt)
            outBuf.push(line)
            post('print', { line })
          },
          printErr: (txt: unknown) => {
            const line = String(txt)
            outBuf.push(line)
            post('print', { line })
          },
        })
        post('ready', {})
        return Module
      } catch (err) {
        Module = null
        modulePromise = null
        post('fatal', {
          error:
            String(err) +
            '\nFailed to load engine module. Ensure the wasm bundle is built with -s EXPORT_ES6=1 and accessible at the configured path.',
        })
        throw err
      }
    })()
  }

  return modulePromise
}

function runArgs(args: string[]) {
  outBuf.length = 0
  try {
    Module.callMain(args)
    const full = outBuf.join('\n')
    post('done', { output: full })
  } catch (err) {
    post('fatal', { error: String(err) })
  }
}

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data ?? {}
  if (msg.type === 'init') {
    try {
      await ensureModule({ scriptUrl: msg.scriptUrl, wasmBinaryUrl: msg.wasmBinaryUrl })
    } catch {
      // errors are reported via fatal message
    }
    return
  }
  if (msg.type === 'run') {
    if (!modulePromise) {
      post('fatal', { error: 'Engine module not initialized' })
      return
    }
    try {
      await modulePromise
      runArgs(msg.args ?? [])
    } catch {
      // ensure fatal already posted
    }
  }
}

self.addEventListener('error', (event) => {
  post('fatal', { error: `Worker error: ${event.message || event.type}` })
})

self.addEventListener('messageerror', () => {
  post('fatal', { error: 'Worker received an unserializable message' })
})

export {}
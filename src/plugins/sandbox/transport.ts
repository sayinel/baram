// §260 Sandbox transport — injectable seam between the machinery and the real
// IPC channel. Tests use an in-memory pair; production uses the two per-webview
// adapters: `tauri-host-transport.ts` (main realm) and
// `tauri-sandbox-transport.ts` (inside the plugin webview).
export interface SandboxTransport<TIn, TOut> {
  close(): void;
  onMessage(handler: (msg: TIn) => void): () => void;
  send(msg: TOut): void;
}

// §260 Sandbox transport — injectable seam between the machinery and the real
// Tauri-event channel. Tests use an in-memory pair; production uses the
// per-session-token WebviewWindow transport (tauri-transport.ts).
export interface SandboxTransport<TIn, TOut> {
  close(): void;
  onMessage(handler: (msg: TIn) => void): () => void;
  send(msg: TOut): void;
}

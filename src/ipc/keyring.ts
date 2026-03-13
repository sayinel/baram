// §6.3 Keyring IPC commands — OS Keychain 암호화 저장
import { invoke } from "@tauri-apps/api/core";

export async function keyringDelete(key: string): Promise<void> {
  return invoke<void>("keyring_delete", { key });
}

export async function keyringGet(key: string): Promise<null | string> {
  return invoke<null | string>("keyring_get", { key });
}

export async function keyringStore(key: string, value: string): Promise<void> {
  return invoke<void>("keyring_store", { key, value });
}

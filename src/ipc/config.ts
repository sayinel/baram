// §3.2 Config IPC commands — app_data_dir/config.json 기반 영속화
import { invoke } from "@tauri-apps/api/core";

export async function getConfig(key: string): Promise<null | string> {
  return invoke<null | string>("get_config", { key });
}

export async function removeConfig(key: string): Promise<void> {
  return invoke<void>("remove_config", { key });
}

export async function setConfig(key: string, value: string): Promise<void> {
  return invoke<void>("set_config", { key, value });
}

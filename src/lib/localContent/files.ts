import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { LocalEntry } from "./model";

export const listLocalFolder = (path: string) =>
  invoke<LocalEntry[]>("list_local_directory", { path });

export async function pickLocalFolder() {
  const path = await open({
    directory: true,
    multiple: false,
    title: "Import local content",
  });
  if (!path || Array.isArray(path)) return null;
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return { uri: path, name: parts[parts.length - 1] || path };
}

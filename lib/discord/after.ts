import { after as nextAfter } from "next/server";

export function after(task: () => void | Promise<void>) {
  try {
    nextAfter(task);
  } catch {
    Promise.resolve().then(task).catch(() => {});
  }
}

import { getAdminSession } from "@/lib/auth/session";

type GetAdminSessionFn = typeof getAdminSession;

let currentGetAdminSession: GetAdminSessionFn = getAdminSession;

export async function getRetrySession() {
  return currentGetAdminSession();
}

export function __setGetSession(fn: GetAdminSessionFn): void {
  currentGetAdminSession = fn;
}

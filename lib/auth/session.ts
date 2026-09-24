import { sealData, unsealData, SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface AdminSession {
  adminId: string;
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET || "at-least-32-characters-secret-string-for-iron-session-change-in-production",
  cookieName: "admin_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
};

export async function createSessionToken(adminId: string): Promise<string> {
  return sealData({ adminId }, sessionOptions);
}

export async function verifySessionToken(token: string): Promise<AdminSession | null> {
  try {
    const data = await unsealData<AdminSession>(token, sessionOptions);
    if (data && typeof data.adminId === "string") {
      return { adminId: data.adminId };
    }
    return null;
  } catch {
    return null;
  }
}

export async function setAdminSession(adminId: string): Promise<void> {
  const token = await createSessionToken(adminId);
  const cookieStore = await cookies();
  cookieStore.set(sessionOptions.cookieName, token, sessionOptions.cookieOptions);
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(sessionOptions.cookieName);
  if (!cookie?.value) {
    return null;
  }
  return verifySessionToken(cookie.value);
}

export async function destroyAdminSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(sessionOptions.cookieName, "", {
    ...sessionOptions.cookieOptions,
    maxAge: 0,
  });
}

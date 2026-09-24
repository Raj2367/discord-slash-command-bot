export function validateTimestamp(
  timestampStr: string | null | undefined,
  maxAgeSeconds: number = 300,
  nowMs: number = Date.now()
): boolean {
  if (!timestampStr || typeof timestampStr !== "string") {
    return false;
  }

  const timestampNum = Number(timestampStr);
  if (!Number.isInteger(timestampNum) || timestampNum <= 0) {
    return false;
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  const ageSeconds = nowSeconds - timestampNum;

  // Reject if older than maxAgeSeconds
  if (ageSeconds > maxAgeSeconds) {
    return false;
  }

  // Reject if in the future beyond a 5-second clock skew allowance
  const maxFutureSkewSeconds = 5;
  if (timestampNum > nowSeconds + maxFutureSkewSeconds) {
    return false;
  }

  return true;
}

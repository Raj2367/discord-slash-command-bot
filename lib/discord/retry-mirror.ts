import {
  deliverMirror,
  DeliverMirrorInput,
} from "./deliver-mirror";
import { DeliveryResult } from "./deliver-interaction-response";

export type RetriedMirrorResult = DeliveryResult & {
  attempts: number;
};

export interface RetryMirrorOptions {
  deliverer?: (
    input: DeliverMirrorInput
  ) => Promise<DeliveryResult>;
  sleep?: (ms: number) => Promise<void>;
}

export async function retryMirror(
  input: DeliverMirrorInput,
  options: RetryMirrorOptions = {}
): Promise<RetriedMirrorResult> {
  const deliverer = options.deliverer || deliverMirror;
  const sleep =
    options.sleep ||
    ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  const delays = [1000, 3000];
  const maxAttempts = 3;

  let attempts = 0;
  let lastResult: DeliveryResult = {
    success: false,
    category: "network",
    error: "No delivery attempts executed",
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts++;
    const result = await deliverer(input);
    lastResult = result;

    if (result.success) {
      return { ...result, attempts };
    }

    if (result.category === "permanent") {
      return { ...result, attempts };
    }

    if (attempt >= maxAttempts) {
      break;
    }

    const delayMs = delays[attempt - 1] || 1000;
    await sleep(delayMs);
  }

  return { ...lastResult, attempts };
}

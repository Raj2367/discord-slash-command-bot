import {
  deliverInteractionResponse,
  DeliverInteractionResponseInput,
  DeliveryResult,
} from "./deliver-interaction-response";

export interface RetryDeliveryOptions {
  deliverer?: (
    input: DeliverInteractionResponseInput
  ) => Promise<DeliveryResult>;
  sleep?: (ms: number) => Promise<void>;
}

export async function retryDiscordDelivery(
  input: DeliverInteractionResponseInput,
  options: RetryDeliveryOptions = {}
): Promise<DeliveryResult> {
  const deliverer = options.deliverer || deliverInteractionResponse;
  const sleep =
    options.sleep ||
    ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  const delays = [1000, 3000]; // After attempt 1 (~1s), after attempt 2 (~3s)
  const maxAttempts = 3;

  let lastResult: DeliveryResult = {
    success: false,
    category: "network",
    error: "No delivery attempts executed",
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await deliverer(input);
    lastResult = result;

    if (result.success) {
      return result;
    }

    if (result.category === "permanent") {
      return result;
    }

    if (attempt >= maxAttempts) {
      break;
    }

    const delayMs = delays[attempt - 1] || 1000;
    await sleep(delayMs);
  }

  return lastResult;
}

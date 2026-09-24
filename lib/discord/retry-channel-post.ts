import {
  deliverChannelPost,
  DeliverChannelPostInput,
  ChannelPostDeliveryResult,
} from "./deliver-channel-post";

export type RetriedChannelPostResult = ChannelPostDeliveryResult & {
  attempts: number;
};

export interface RetryChannelPostOptions {
  deliverer?: (
    input: DeliverChannelPostInput
  ) => Promise<ChannelPostDeliveryResult>;
  sleep?: (ms: number) => Promise<void>;
}

export async function retryChannelPost(
  input: DeliverChannelPostInput,
  options: RetryChannelPostOptions = {}
): Promise<RetriedChannelPostResult> {
  const deliverer = options.deliverer || deliverChannelPost;
  const sleep =
    options.sleep ||
    ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  const delays = [1000, 3000]; // After attempt 1 (~1s), after attempt 2 (~3s)
  const maxAttempts = 3;

  let attempts = 0;
  let lastResult: ChannelPostDeliveryResult = {
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

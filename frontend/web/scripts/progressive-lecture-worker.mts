import { ServiceBusClient, type ServiceBusReceivedMessage } from "@azure/service-bus";
import type { DequeuedMessageItem, QueueClient } from "@azure/storage-queue";
import {
  decodeProgressiveTask,
  encodeProgressiveTask,
  progressiveQueueTransport,
  progressiveStorageQueueClient,
  readyProgressiveStorageQueue,
} from "../lib/progressiveLectureQueue";
import { processProgressiveLectureTask } from "../lib/progressiveLectureWorker";
import { runInSlots } from "../lib/progressiveWorkerSlots";
import type { ProgressiveLectureTask } from "../lib/progressiveLectureTypes";

const maxConcurrentCalls = Math.max(1, Math.min(12, Number(process.env.PROGRESSIVE_WORKER_CONCURRENCY ?? 4)));
let stopping = false;

function isTask(value: unknown): value is ProgressiveLectureTask {
  if (!value || typeof value !== "object") return false;
  const task = value as Record<string, unknown>;
  return task.version === 1 &&
    ["plan", "generate-beat", "enrich-beat"].includes(String(task.type)) &&
    typeof task.sessionId === "string" &&
    typeof task.userId === "string";
}

function isWake(value: unknown): value is { type: "wake"; enqueuedAt?: number } {
  return Boolean(value && typeof value === "object" && (value as Record<string, unknown>).type === "wake");
}

async function runStorageQueue(): Promise<void> {
  const queue = await readyProgressiveStorageQueue();
  const queueName = process.env.AZURE_STORAGE_QUEUE as string;
  const poison = progressiveStorageQueueClient(`${queueName}-poison`);
  await poison.createIfNotExists();
  console.log(`[progressive-worker] listening on Azure Storage Queue ${queueName} with concurrency ${maxConcurrentCalls}`);

  await runInSlots({
    slots: maxConcurrentCalls,
    stopping: () => stopping,
    receive: async (max) => (await queue.receiveMessages({ numberOfMessages: Math.min(32, max), visibilityTimeout: 30 * 60 })).receivedMessageItems,
    handle: (message) => processStorageMessage(queue, poison, message),
  });
}

async function processStorageMessage(queue: QueueClient, poison: QueueClient, message: DequeuedMessageItem): Promise<void> {
  let raw: unknown;
  try {
    raw = decodeProgressiveTask(message.messageText);
  } catch {
    await poison.sendMessage(message.messageText);
    await queue.deleteMessage(message.messageId, message.popReceipt);
    return;
  }
  // A wake-up (lib/progressiveLectureQueue.ts wakeLectureWorker): receiving it started this worker; nothing to do.
  if (isWake(raw)) {
    const waited = typeof raw.enqueuedAt === "number" ? Date.now() - raw.enqueuedAt : null;
    console.log(`[timing] kind=wake${waited === null ? "" : ` ms=${waited}`}`);
    await queue.deleteMessage(message.messageId, message.popReceipt);
    return;
  }
  if (!isTask(raw)) {
    await poison.sendMessage(message.messageText);
    await queue.deleteMessage(message.messageId, message.popReceipt);
    return;
  }
  try {
    await processProgressiveLectureTask(raw);
    await queue.deleteMessage(message.messageId, message.popReceipt);
  } catch (error) {
    console.error(`[progressive-worker] ${raw.sessionId}:${raw.type} failed:`, error);
    if (message.dequeueCount >= 5) {
      await poison.sendMessage(encodeProgressiveTask(raw));
      await queue.deleteMessage(message.messageId, message.popReceipt);
    }
    // Otherwise the visibility timeout expires and Azure retries the idempotent task.
  }
}

async function runServiceBus(): Promise<void> {
  const connectionString = process.env.AZURE_SERVICE_BUS_CONNECTION_STRING;
  const queueName = process.env.AZURE_SERVICE_BUS_QUEUE;
  if (!connectionString || !queueName) throw new Error("Service Bus transport was selected but is not configured.");
  const client = new ServiceBusClient(connectionString);
  const receiver = client.createReceiver(queueName, {
    receiveMode: "peekLock",
    maxAutoLockRenewalDurationInMs: 10 * 60_000,
  });
  const subscription = receiver.subscribe({
    processMessage: async (message: ServiceBusReceivedMessage) => {
      if (isWake(message.body)) {
        await receiver.completeMessage(message);
        return;
      }
      if (!isTask(message.body)) {
        await receiver.deadLetterMessage(message, {
          deadLetterReason: "Invalid progressive lecture task",
          deadLetterErrorDescription: "Message body did not match ProgressiveLectureTask v1.",
        });
        return;
      }
      try {
        await processProgressiveLectureTask(message.body);
        await receiver.completeMessage(message);
      } catch (error) {
        console.error(`[progressive-worker] ${message.messageId ?? "unknown"} failed:`, error);
        if ((message.deliveryCount ?? 0) >= 5) await receiver.deadLetterMessage(message);
        else await receiver.abandonMessage(message);
      }
    },
    processError: async (args) => console.error(`[progressive-worker] Service Bus ${args.errorSource} error:`, args.error),
  }, { autoCompleteMessages: false, maxConcurrentCalls });
  console.log(`[progressive-worker] listening on Service Bus ${queueName} with concurrency ${maxConcurrentCalls}`);
  while (!stopping) await delay(1_000);
  await subscription.close();
  await receiver.close();
  await client.close();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });

const transport = progressiveQueueTransport();
if (transport === "in-process-development") {
  throw new Error("The standalone worker requires Azure Storage Queue or Service Bus, not the development in-process transport.");
}
await (transport === "azure-storage-queue" ? runStorageQueue() : runServiceBus());

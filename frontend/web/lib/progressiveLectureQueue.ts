import "server-only";

import { ServiceBusClient, type ServiceBusMessage } from "@azure/service-bus";
import { QueueServiceClient, type QueueClient } from "@azure/storage-queue";
import type { ProgressiveLectureTask } from "./progressiveLectureTypes";

const globalForQueue = globalThis as unknown as {
  ariaServiceBus?: ServiceBusClient;
  ariaStorageQueue?: QueueClient;
  ariaStorageQueueReady?: Promise<QueueClient>;
  ariaProgressiveLocalQueue?: ProgressiveLectureTask[];
  ariaProgressiveLocalActive?: number;
};

export function progressiveServiceBusConfigured(): boolean {
  return Boolean(process.env.AZURE_SERVICE_BUS_CONNECTION_STRING && process.env.AZURE_SERVICE_BUS_QUEUE);
}

export function progressiveStorageQueueConfigured(): boolean {
  return Boolean(process.env.AZURE_STORAGE_CONNECTION_STRING && process.env.AZURE_STORAGE_QUEUE);
}

export type ProgressiveQueueTransport = "azure-storage-queue" | "azure-service-bus" | "in-process-development";

/** Development stays zero-setup. Production prefers the queue service already included in the
 * lecture Blob storage account, with Service Bus retained only as a backwards-compatible option. */
export function progressiveQueueTransport(): ProgressiveQueueTransport {
  const requested = process.env.PROGRESSIVE_QUEUE_TRANSPORT?.trim().toLowerCase();
  if (process.env.NODE_ENV === "development" && !requested) return "in-process-development";
  if (requested === "storage" || requested === "azure-storage-queue") return "azure-storage-queue";
  if (requested === "service-bus" || requested === "azure-service-bus") return "azure-service-bus";
  if (requested === "in-process" && process.env.PROGRESSIVE_IN_PROCESS_WORKER === "1") return "in-process-development";
  if (progressiveStorageQueueConfigured()) return "azure-storage-queue";
  if (progressiveServiceBusConfigured()) return "azure-service-bus";
  if (process.env.PROGRESSIVE_IN_PROCESS_WORKER === "1") return "in-process-development";
  throw new Error("Configure AZURE_STORAGE_QUEUE for the production lecture worker.");
}

export function progressiveStorageQueueClient(queueName = process.env.AZURE_STORAGE_QUEUE): QueueClient {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) throw new Error("AZURE_STORAGE_CONNECTION_STRING is not set.");
  if (!queueName) throw new Error("AZURE_STORAGE_QUEUE is not set.");
  if (queueName === process.env.AZURE_STORAGE_QUEUE && globalForQueue.ariaStorageQueue) {
    return globalForQueue.ariaStorageQueue;
  }
  const client = QueueServiceClient.fromConnectionString(connectionString).getQueueClient(queueName);
  if (queueName === process.env.AZURE_STORAGE_QUEUE) globalForQueue.ariaStorageQueue = client;
  return client;
}

export async function readyProgressiveStorageQueue(): Promise<QueueClient> {
  if (!globalForQueue.ariaStorageQueueReady) {
    globalForQueue.ariaStorageQueueReady = (async () => {
      const queue = progressiveStorageQueueClient();
      await queue.createIfNotExists();
      return queue;
    })().catch((error) => {
      globalForQueue.ariaStorageQueueReady = undefined;
      throw error;
    });
  }
  return globalForQueue.ariaStorageQueueReady;
}

export function encodeProgressiveTask(task: ProgressiveLectureTask): string {
  return Buffer.from(JSON.stringify(task), "utf8").toString("base64");
}

export function decodeProgressiveTask(messageText: string): unknown {
  return JSON.parse(Buffer.from(messageText, "base64").toString("utf8"));
}

function serviceBusClient(): ServiceBusClient {
  const connectionString = process.env.AZURE_SERVICE_BUS_CONNECTION_STRING;
  if (!connectionString) throw new Error("AZURE_SERVICE_BUS_CONNECTION_STRING is not set.");
  globalForQueue.ariaServiceBus ??= new ServiceBusClient(connectionString);
  return globalForQueue.ariaServiceBus;
}

export async function dispatchProgressiveTasks(tasks: ProgressiveLectureTask[]): Promise<void> {
  if (tasks.length === 0) return;
  const transport = progressiveQueueTransport();
  if (transport === "in-process-development") {
    enqueueLocal(tasks);
    return;
  }

  if (transport === "azure-storage-queue") {
    const queue = await readyProgressiveStorageQueue();
    await Promise.all(tasks.map((task) => queue.sendMessage(encodeProgressiveTask(task))));
    return;
  }

  const queueName = process.env.AZURE_SERVICE_BUS_QUEUE as string;
  const sender = serviceBusClient().createSender(queueName);
  try {
    const messages: ServiceBusMessage[] = tasks.map((task) => ({
      body: task,
      contentType: "application/json",
      messageId: taskMessageId(task),
      correlationId: task.sessionId,
      subject: task.type,
      applicationProperties: {
        version: task.version,
        sequence: "sequence" in task ? task.sequence : -1,
      },
    }));
    await sender.sendMessages(messages);
  } finally {
    await sender.close();
  }
}

function taskMessageId(task: ProgressiveLectureTask): string {
  return `${task.sessionId}:${task.type}:${"sequence" in task ? task.sequence : "session"}:${"revision" in task ? task.revision : 1}`;
}

function enqueueLocal(tasks: ProgressiveLectureTask[]): void {
  globalForQueue.ariaProgressiveLocalQueue ??= [];
  globalForQueue.ariaProgressiveLocalQueue.push(...tasks);
  queueMicrotask(drainLocalQueue);
}

async function drainLocalQueue(): Promise<void> {
  const limit = Math.max(1, Math.min(6, Number(process.env.PROGRESSIVE_WORKER_CONCURRENCY ?? 3)));
  globalForQueue.ariaProgressiveLocalActive ??= 0;
  const queue = globalForQueue.ariaProgressiveLocalQueue ?? [];
  while ((globalForQueue.ariaProgressiveLocalActive ?? 0) < limit && queue.length > 0) {
    const task = queue.shift() as ProgressiveLectureTask;
    globalForQueue.ariaProgressiveLocalActive = (globalForQueue.ariaProgressiveLocalActive ?? 0) + 1;
    void import("./progressiveLectureWorker")
      .then(({ processProgressiveLectureTask }) => processProgressiveLectureTask(task))
      .catch((error) => {
        console.error(`[progressive-worker] ${task.type} failed:`, error);
      })
      .finally(() => {
        globalForQueue.ariaProgressiveLocalActive = Math.max(0, (globalForQueue.ariaProgressiveLocalActive ?? 1) - 1);
        queueMicrotask(drainLocalQueue);
      });
  }
}

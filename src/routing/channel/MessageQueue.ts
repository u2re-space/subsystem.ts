/**
 * Message Queue for CrossWord
 * Re-exports fest/uniform MessageQueue with app-specific configuration
 */

import {
    MessageQueue as BaseMessageQueue,
    getMessageQueue as getBaseMessageQueue,
    createMessageQueue,
    type QueuedMessage,
    type MessagePriority,
    type MessageQueueOptions,
    type QueueMessageOptions
} from 'fest/uniform';

// Re-export types
export type { QueuedMessage, MessagePriority, MessageQueueOptions, QueueMessageOptions };

// App-specific configuration
const APP_QUEUE_OPTIONS: MessageQueueOptions = {
    dbName: 'CrossWordMessageQueue',
    storeName: 'messages',
    maxRetries: 3,
    defaultExpirationMs: 24 * 60 * 60 * 1000, // 24 hours
    fallbackStorageKey: 'workcenter_message_queue'
};

// Singleton instance
let messageQueueInstance: BaseMessageQueue | null = null;

/**
 * Get the app-configured MessageQueue instance
 */
export function getMessageQueue(): BaseMessageQueue {
    if (!messageQueueInstance) {
        messageQueueInstance = getBaseMessageQueue(APP_QUEUE_OPTIONS);
    }
    return messageQueueInstance;
}

// Re-export the class for advanced usage
export { BaseMessageQueue as MessageQueue, createMessageQueue };

/**
 * Work Message Types
 *
 * Work messages are commands (tasks to be done), as opposed to events (facts that happened).
 * They flow through dedicated work topics to specific agents.
 */

export type WorkType = 'fetch_link' | 'enrich_link' | 'publish_link';

export interface WorkMessage {
  /** The subject this work relates to (e.g., link:abc123) */
  subject_id: string;

  /** Type of work to be done */
  work_type: WorkType;

  /** Trace back to the original event chain */
  correlation_id: string;

  /** The event that triggered this work */
  triggered_by_event_id: string;

  /** Attempt number, starts at 1, incremented on retry */
  attempt: number;

  /** Maximum attempts before sending to dead letter queue */
  max_attempts: number;

  /** When this work message was created */
  created_at: string;

  /** Error from previous attempt (populated on retry) */
  last_error?: string;

  /** Work-specific payload (minimal - just what the agent needs) */
  payload: Record<string, unknown>;

  /** Index signature for JSON compatibility */
  [key: string]: unknown;
}

export interface DeadLetterMessage {
  /** The original work message that failed */
  original_work: WorkMessage;

  /** The final error that caused the message to be dead-lettered */
  final_error: string;

  /** When the message was sent to dead letter queue */
  failed_at: string;

  /** Which agent failed to process this work */
  agent: string;
}

/** Default max attempts for each work type */
export const DEFAULT_MAX_ATTEMPTS: Record<WorkType, number> = {
  fetch_link: 3,
  enrich_link: 3,
  publish_link: 3,
};

/** Kafka topic names for work queues */
export const WORK_TOPICS = {
  FETCH_LINK: 'work.fetch_link',
  ENRICH_LINK: 'work.enrich_link',
  PUBLISH_LINK: 'work.publish_link',
  DEAD_LETTER: 'work.dead_letter',
} as const;

/** Map work types to their topics */
export const WORK_TYPE_TO_TOPIC: Record<WorkType, string> = {
  fetch_link: WORK_TOPICS.FETCH_LINK,
  enrich_link: WORK_TOPICS.ENRICH_LINK,
  publish_link: WORK_TOPICS.PUBLISH_LINK,
};

/**
 * Create a new work message
 */
export function createWorkMessage(
  workType: WorkType,
  subjectId: string,
  triggeredByEventId: string,
  correlationId: string,
  payload: Record<string, unknown> = {},
  options: { attempt?: number; lastError?: string } = {}
): WorkMessage {
  return {
    subject_id: subjectId,
    work_type: workType,
    correlation_id: correlationId,
    triggered_by_event_id: triggeredByEventId,
    attempt: options.attempt ?? 1,
    max_attempts: DEFAULT_MAX_ATTEMPTS[workType],
    created_at: new Date().toISOString(),
    last_error: options.lastError,
    payload,
  };
}

/**
 * Create a retry work message from a failed work message
 */
export function createRetryWorkMessage(
  originalWork: WorkMessage,
  error: string
): WorkMessage {
  return {
    ...originalWork,
    attempt: originalWork.attempt + 1,
    created_at: new Date().toISOString(),
    last_error: error,
  };
}

/**
 * Create a dead letter message
 */
export function createDeadLetterMessage(
  originalWork: WorkMessage,
  finalError: string,
  agent: string
): DeadLetterMessage {
  return {
    original_work: originalWork,
    final_error: finalError,
    failed_at: new Date().toISOString(),
    agent,
  };
}

/**
 * Check if a work message should be retried
 */
export function shouldRetry(work: WorkMessage): boolean {
  return work.attempt < work.max_attempts;
}

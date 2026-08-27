export class ServiceError extends Error {
  statusCode: number;
  messageKey: string;
  details?: unknown;
  constructor(messageKey: string, statusCode: number, details?: unknown) {
    super(messageKey);
    this.messageKey = messageKey;
    this.statusCode = statusCode;
    this.details = details;
  }
}

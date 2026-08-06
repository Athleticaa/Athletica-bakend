export class ServiceError extends Error {
  statusCode: number;
  messageKey: string;
  constructor(messageKey: string, statusCode: number) {
    super(messageKey);
    this.messageKey = messageKey;
    this.statusCode = statusCode;
  }
}

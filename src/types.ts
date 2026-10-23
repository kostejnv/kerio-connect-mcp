/**
 * Types for the parts of the Kerio Connect client JSON-RPC API used by this server.
 * Reference: https://manuals.gfi.com/en/kerio/api/connect/client/reference/index.html
 */

export interface KerioCredentials {
  /** Server origin, e.g. https://mail.example.com */
  server: string;
  username: string;
  password: string;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export interface EmailAddress {
  address?: string;
  name?: string;
}

export interface KerioFolder {
  id: string;
  name: string;
  type: string;
  parentId?: string;
  [key: string]: unknown;
}

export interface DisplayablePart {
  contentType: 'ctTextPlain' | 'ctTextHtml' | string;
  content: string;
}

export interface KerioAttachment {
  id?: string;
  name?: string;
  contentType?: string;
  size?: number;
}

export interface KerioMail {
  id: string;
  folderId?: string;
  from?: EmailAddress;
  to?: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  replyTo?: EmailAddress[];
  subject?: string;
  receiveDate?: string;
  sendDate?: string;
  isSeen?: boolean;
  isFlagged?: boolean;
  isAnswered?: boolean;
  isDraft?: boolean;
  hasAttachment?: boolean;
  size?: number;
  displayableParts?: DisplayablePart[];
  attachments?: KerioAttachment[];
}

export interface SearchCondition {
  fieldName: string;
  comparator: 'Eq' | 'NotEq' | 'LessThan' | 'GreaterThan' | 'LessEq' | 'GreaterEq' | 'Like';
  value: string;
}

export interface KerioError {
  code?: number | string;
  message?: string;
  inputIndex?: number;
}

export interface MailsGetResult {
  list: KerioMail[];
  totalItems: number;
}

export interface MailsGetByIdResult {
  result: KerioMail[];
  errors: KerioError[];
}

export interface MailsCreateResult {
  result: Array<{ id?: string; inputIndex?: number }>;
  errors: KerioError[];
}

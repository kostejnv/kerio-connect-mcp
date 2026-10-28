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
  /** FSubInbox, FSubSentItems, FSubDrafts, FSubDeletedItems, FSubJunkEmail, FSubNone, ... */
  subType?: string;
  parentId?: string;
  [key: string]: unknown;
}

export interface DisplayablePart {
  contentType: 'ctTextPlain' | 'ctTextHtml' | string;
  content: string;
}

export interface KerioAttachment {
  id?: string;
  /** Download path relative to the server root, e.g. /webmail/api/download/attachment/... */
  url?: string;
  name?: string;
  contentType?: string;
  /** Set for inline attachments referenced from the HTML body (cid:). */
  contentId?: string;
  size?: number;
}

/** A MIME header Kerio exposes, e.g. mhMessageID or mhInReplayTo (sic, Kerio's spelling). */
export interface MailHeader {
  type: string;
  value: string;
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
  headers?: MailHeader[];
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

/** Result of Mails.create and Mails.set. */
export interface MailsWriteResult {
  result: Array<{ id?: string; inputIndex?: number }>;
  errors: KerioError[];
}

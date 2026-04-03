import type {
  CreateConversationMessageRequest,
  LoginRequest,
  MembershipCommandRequest,
  SetReactionRequest,
  UpdateMessageRequest,
} from '@betterchat/contracts';
import { open, rm, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BetterChatConfig } from './config';
import { AppError, toAppError } from './errors';
import { parsePaginationRequest, type PaginationRequest } from './pagination';

const IMAGE_SIGNATURE_SAMPLE_BYTES = 64;
const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Uint8Array.from([0xff, 0xd8, 0xff]);
const GIF87A_SIGNATURE = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);
const GIF89A_SIGNATURE = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const BMP_SIGNATURE = Uint8Array.from([0x42, 0x4d]);
const RIFF_SIGNATURE = Uint8Array.from([0x52, 0x49, 0x46, 0x46]);
const WEBP_SIGNATURE = Uint8Array.from([0x57, 0x45, 0x42, 0x50]);
const AVIF_BRANDS = new Set(['avif', 'avis']);
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']);
const MAX_MESSAGE_PAGE_SIZE = 100;
const DEFAULT_CONTEXT_MESSAGES_AFTER = 20;
const DEFAULT_CONTEXT_MESSAGES_BEFORE = 20;
const MAX_CONTEXT_MESSAGES = 100;
const MAX_MULTIPART_ENVELOPE_BYTES = 256 * 1024;
const MULTIPART_HEADER_TERMINATOR = '\r\n\r\n';
const CRLF = '\r\n';
export const uploadTempFilePrefix = 'betterchat-upload-';
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const multipartHeaderTerminatorBytes = textEncoder.encode(MULTIPART_HEADER_TERMINATOR);

const uploadTempFilePathFrom = (): string => join(tmpdir(), `${uploadTempFilePrefix}${crypto.randomUUID()}`);

export const readJsonBody = async <T>(request: Request): Promise<T> => {
  try {
    return (await request.json()) as T;
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Request body must be valid JSON', 400);
  }
};

export const parseLoginRequest = (input: LoginRequest): LoginRequest => {
  if (typeof input.login !== 'string' || input.login.trim().length === 0) {
    throw new AppError('VALIDATION_ERROR', '"login" is required', 400);
  }

  if (typeof input.password !== 'string' || input.password.length === 0) {
    throw new AppError('VALIDATION_ERROR', '"password" is required', 400);
  }

  if (input.code !== undefined && (typeof input.code !== 'string' || input.code.trim().length === 0)) {
    throw new AppError('VALIDATION_ERROR', '"code" must be a non-empty string when provided', 400);
  }

  return {
    login: input.login.trim(),
    password: input.password,
    ...(input.code ? { code: input.code.trim() } : {}),
  };
};

export const parseCreateConversationMessageRequest = (
  input: CreateConversationMessageRequest,
): CreateConversationMessageRequest => {
  if (!input || typeof input !== 'object') {
    throw new AppError('VALIDATION_ERROR', 'Request body must be valid JSON', 400);
  }

  const target = input.target;
  const content = input.content;
  const submissionId = input.submissionId;

  if (!target || typeof target !== 'object') {
    throw new AppError('VALIDATION_ERROR', '"target" is required', 400);
  }

  if (!content || typeof content !== 'object') {
    throw new AppError('VALIDATION_ERROR', '"content" is required', 400);
  }

  if (submissionId !== undefined && (typeof submissionId !== 'string' || submissionId.trim().length === 0)) {
    throw new AppError('VALIDATION_ERROR', '"submissionId" must be a non-empty string when provided', 400);
  }

  const normalizedSubmissionId = submissionId?.trim();

  if (content.format !== 'markdown') {
    throw new AppError('VALIDATION_ERROR', '"content.format" must be "markdown"', 400);
  }

  if (typeof content.text !== 'string' || content.text.trim().length === 0) {
    throw new AppError('VALIDATION_ERROR', '"content.text" is required', 400);
  }

  if (target.kind === 'conversation') {
    if (
      target.replyToMessageId !== undefined
      && (typeof target.replyToMessageId !== 'string' || target.replyToMessageId.trim().length === 0)
    ) {
      throw new AppError('VALIDATION_ERROR', '"target.replyToMessageId" must be a non-empty string when provided', 400);
    }

    return {
      ...(normalizedSubmissionId ? { submissionId: normalizedSubmissionId } : {}),
      target: {
        kind: 'conversation',
        ...(target.replyToMessageId ? { replyToMessageId: target.replyToMessageId.trim() } : {}),
      },
      content: {
        format: 'markdown',
        text: content.text.trim(),
      },
    };
  }

  if (target.kind === 'thread') {
    if (typeof target.threadId !== 'string' || target.threadId.trim().length === 0) {
      throw new AppError('VALIDATION_ERROR', '"target.threadId" is required for thread messages', 400);
    }

    if (target.echoToConversation !== undefined && typeof target.echoToConversation !== 'boolean') {
      throw new AppError('VALIDATION_ERROR', '"target.echoToConversation" must be a boolean when provided', 400);
    }

    return {
      ...(normalizedSubmissionId ? { submissionId: normalizedSubmissionId } : {}),
      target: {
        kind: 'thread',
        threadId: target.threadId.trim(),
        ...(target.echoToConversation !== undefined ? { echoToConversation: target.echoToConversation } : {}),
      },
      content: {
        format: 'markdown',
        text: content.text.trim(),
      },
    };
  }

  throw new AppError('VALIDATION_ERROR', '"target.kind" must be "conversation" or "thread"', 400);
};

export const parseMembershipCommandRequest = (input: MembershipCommandRequest): MembershipCommandRequest => {
  if (!input || typeof input !== 'object') {
    throw new AppError('VALIDATION_ERROR', 'Request body must be valid JSON', 400);
  }

  switch (input.type) {
    case 'set-starred':
      if (typeof input.value !== 'boolean') {
        throw new AppError('VALIDATION_ERROR', '"value" must be a boolean for set-starred', 400);
      }

      return input;

    case 'set-listing':
      if (input.value !== 'listed' && input.value !== 'hidden') {
        throw new AppError('VALIDATION_ERROR', '"value" must be "listed" or "hidden" for set-listing', 400);
      }

      return input;

    case 'mark-read':
      if (input.includeThreads !== undefined && typeof input.includeThreads !== 'boolean') {
        throw new AppError('VALIDATION_ERROR', '"includeThreads" must be a boolean when provided', 400);
      }

      return input;

    case 'mark-unread':
      if (
        input.fromMessageId !== undefined
        && (typeof input.fromMessageId !== 'string' || input.fromMessageId.trim().length === 0)
      ) {
        throw new AppError('VALIDATION_ERROR', '"fromMessageId" must be a non-empty string when provided', 400);
      }

      return {
        type: 'mark-unread',
        ...(input.fromMessageId ? { fromMessageId: input.fromMessageId.trim() } : {}),
      };

    default:
      throw new AppError('VALIDATION_ERROR', 'Unsupported membership command type', 400);
  }
};

export const parseUpdateMessageRequest = (input: UpdateMessageRequest): UpdateMessageRequest => {
  if (!input || typeof input !== 'object') {
    throw new AppError('VALIDATION_ERROR', 'Request body must be valid JSON', 400);
  }

  if (typeof input.text !== 'string' || input.text.trim().length === 0) {
    throw new AppError('VALIDATION_ERROR', '"text" is required', 400);
  }

  if (
    input.replyToMessageId !== undefined
    && input.replyToMessageId !== null
    && (typeof input.replyToMessageId !== 'string' || input.replyToMessageId.trim().length === 0)
  ) {
    throw new AppError('VALIDATION_ERROR', '"replyToMessageId" must be a non-empty string or null when provided', 400);
  }

  return {
    text: input.text.trim(),
    ...(input.replyToMessageId === null
      ? { replyToMessageId: null }
      : input.replyToMessageId
        ? { replyToMessageId: input.replyToMessageId.trim() }
        : {}),
  };
};

export const parseReactionRequest = (input: SetReactionRequest): SetReactionRequest => {
  if (typeof input.emoji !== 'string' || input.emoji.trim().length === 0) {
    throw new AppError('VALIDATION_ERROR', '"emoji" is required', 400);
  }

  if (input.shouldReact !== undefined && typeof input.shouldReact !== 'boolean') {
    throw new AppError('VALIDATION_ERROR', '"shouldReact" must be a boolean when provided', 400);
  }

  return {
    emoji: input.emoji.trim(),
    ...(input.shouldReact !== undefined ? { shouldReact: input.shouldReact } : {}),
  };
};

const parseOptionalTextField = (value: FormDataEntryValue | null, fieldName: string): string | undefined => {
  if (value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new AppError('VALIDATION_ERROR', `"${fieldName}" must be a string when provided`, 400);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const parseOptionalBooleanField = (value: FormDataEntryValue | null, fieldName: string): boolean | undefined => {
  if (value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new AppError('VALIDATION_ERROR', `"${fieldName}" must be a boolean string when provided`, 400);
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === '') {
    return undefined;
  }

  if (normalized === 'true') {
    return true;
  }

  if (normalized === 'false') {
    return false;
  }

  throw new AppError('VALIDATION_ERROR', `"${fieldName}" must be \"true\" or \"false\" when provided`, 400);
};

export const abortUnreadRequestBody = (request: Request): void => {
  if (request.bodyUsed || request.body === null) {
    return;
  }

  void request.body.cancel().catch(() => {
    // Best-effort: closing the connection remains the authoritative fallback.
  });
};

const rejectMultipartRequest = (request: Request, error: AppError): never => {
  abortUnreadRequestBody(request);
  throw error;
};

const parseContentLength = (request: Request): number | undefined => {
  const value = request.headers.get('content-length');
  if (value === null) {
    return undefined;
  }

  if (!/^\d+$/.test(value)) {
    throw new AppError('VALIDATION_ERROR', '"Content-Length" must be a positive integer when provided', 400);
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new AppError('VALIDATION_ERROR', '"Content-Length" must be a positive integer when provided', 400);
  }

  return parsed;
};

const concatBytes = (chunks: readonly Uint8Array[], totalLength: number): Uint8Array => {
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
};

const startsWithBytes = (bytes: Uint8Array, prefix: Uint8Array): boolean =>
  bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value);

const matchesPrefixBytes = (bytes: Uint8Array, prefix: Uint8Array): boolean =>
  bytes.length <= prefix.length && bytes.every((value, index) => value === prefix[index]);

const indexOfBytes = (bytes: Uint8Array, pattern: Uint8Array): number => {
  if (pattern.length === 0) {
    return 0;
  }

  for (let index = 0; index <= bytes.length - pattern.length; index += 1) {
    let matched = true;

    for (let patternIndex = 0; patternIndex < pattern.length; patternIndex += 1) {
      if (bytes[index + patternIndex] !== pattern[patternIndex]) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return index;
    }
  }

  return -1;
};

const multipartBoundaryFrom = (request: Request): string => {
  const contentType = request.headers.get('content-type');
  if (!contentType) {
    throw new AppError('VALIDATION_ERROR', 'Request body must be valid multipart form data', 400);
  }

  const match = /multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = match?.[1] || match?.[2]?.trim();
  if (!boundary) {
    throw new AppError('VALIDATION_ERROR', 'Request body must be valid multipart form data', 400);
  }

  return boundary;
};

const headerParamFrom = (value: string, paramName: string): string | undefined => {
  const match = new RegExp(`${paramName}=(?:"([^"]*)"|([^;]+))`, 'i').exec(value);
  return match?.[1] ?? match?.[2]?.trim();
};

const parseMultipartPartHeaders = (headerBlock: string): {
  contentType?: string;
  filename?: string;
  name: string;
} => {
  let disposition: string | undefined;
  let contentType: string | undefined;

  for (const line of headerBlock.split(CRLF)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) {
      throw new AppError('VALIDATION_ERROR', 'Request body must be valid multipart form data', 400);
    }

    const headerName = line.slice(0, separatorIndex).trim().toLowerCase();
    const headerValue = line.slice(separatorIndex + 1).trim();
    if (headerName === 'content-disposition') {
      disposition = headerValue;
      continue;
    }

    if (headerName === 'content-type') {
      contentType = headerValue;
    }
  }

  if (!disposition || !/^form-data\b/i.test(disposition)) {
    throw new AppError('VALIDATION_ERROR', 'Request body must be valid multipart form data', 400);
  }

  const name = headerParamFrom(disposition, 'name');
  if (!name) {
    throw new AppError('VALIDATION_ERROR', 'Request body must be valid multipart form data', 400);
  }

  return {
    name,
    ...(headerParamFrom(disposition, 'filename') !== undefined ? { filename: headerParamFrom(disposition, 'filename') } : {}),
    ...(contentType ? { contentType } : {}),
  };
};

const parseMultipartUpload = async (
  request: Request,
  config: BetterChatConfig,
): Promise<{
  fields: Map<string, string>;
  file: File;
  fileSignature: Uint8Array;
  tempFilePath: string;
  cleanup: () => Promise<void>;
}> => {
  const body = request.body;
  if (body === null) {
    throw new AppError('VALIDATION_ERROR', 'Request body must be valid multipart form data', 400);
  }

  const boundary = multipartBoundaryFrom(request);
  const reader = body.getReader();
  const maxBodyBytes = config.maxUploadBytes + MAX_MULTIPART_ENVELOPE_BYTES;
  const initialBoundary = textEncoder.encode(`--${boundary}\r\n`);
  const partBoundary = textEncoder.encode(`\r\n--${boundary}`);
  const nextPartSuffix = textEncoder.encode('\r\n');
  const finalBoundarySuffix = textEncoder.encode('--');

  let buffer: Uint8Array = new Uint8Array(0);
  let totalBodyBytes = 0;
  type MultipartParseState = 'initial-boundary' | 'headers' | 'field' | 'file' | 'done';
  let state: MultipartParseState = 'initial-boundary';
  let currentFieldName: string | undefined;
  let fieldBufferLength = 0;
  const fieldChunks: Uint8Array[] = [];
  const fields = new Map<string, string>();
  let fileBytes = 0;
  let fileName = 'upload';
  let fileType = '';
  let fileSeen = false;
  const fileSignature = new Uint8Array(IMAGE_SIGNATURE_SAMPLE_BYTES);
  let fileSignatureLength = 0;
  const tempFilePath = uploadTempFilePathFrom();
  let tempFileHandle: FileHandle;
  let tempFileClosed = false;
  let cleanedUp = false;

  try {
    tempFileHandle = await open(tempFilePath, 'wx');
  } catch {
    throw new AppError('UPSTREAM_UNAVAILABLE', 'BetterChat upload spool is unavailable', 503, {
      tempFilePath,
    });
  }

  const closeTempFile = async (): Promise<void> => {
    if (tempFileClosed) {
      return;
    }

    tempFileClosed = true;
    await tempFileHandle.close();
  };

  const cleanup = async (): Promise<void> => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    await rm(tempFilePath, { force: true });
  };

  const fail = async (error: AppError): Promise<never> => {
    try {
      await reader.cancel();
    } catch {
      // Best-effort: the response error remains authoritative.
    }

    try {
      await closeTempFile();
    } catch {
      // Best-effort: temp file cleanup remains authoritative.
    }

    try {
      await cleanup();
    } catch {
      // Best-effort: the response error remains authoritative.
    }

    throw error;
  };

  const setBuffer = (next: Uint8Array): void => {
    buffer = next;
  };

  const appendChunk = (chunk: Uint8Array): void => {
    totalBodyBytes += chunk.length;
    if (totalBodyBytes > maxBodyBytes) {
      throw new AppError('VALIDATION_ERROR', `Image upload exceeds the ${config.maxUploadBytes}-byte limit`, 413, {
        maxUploadBytes: config.maxUploadBytes,
      });
    }

    const next = new Uint8Array(buffer.length + chunk.length);
    next.set(buffer);
    next.set(chunk, buffer.length);
    setBuffer(next);
  };

  const consumeBuffer = (count: number): void => {
    setBuffer(buffer.subarray(count));
  };

  const appendFieldBytes = (bytes: Uint8Array): void => {
    if (bytes.length === 0) {
      return;
    }

    fieldBufferLength += bytes.length;
    if (fieldBufferLength > MAX_MULTIPART_ENVELOPE_BYTES) {
      throw new AppError('VALIDATION_ERROR', 'Request body must be valid multipart form data', 400);
    }

    fieldChunks.push(bytes.slice());
  };

  const appendFileBytes = async (bytes: Uint8Array): Promise<void> => {
    if (bytes.length === 0) {
      return;
    }

    fileBytes += bytes.length;
    if (fileBytes > config.maxUploadBytes) {
      throw new AppError('VALIDATION_ERROR', `Image upload exceeds the ${config.maxUploadBytes}-byte limit`, 413, {
        maxUploadBytes: config.maxUploadBytes,
      });
    }

    if (fileSignatureLength < IMAGE_SIGNATURE_SAMPLE_BYTES) {
      const signatureSlice = bytes.subarray(0, IMAGE_SIGNATURE_SAMPLE_BYTES - fileSignatureLength);
      fileSignature.set(signatureSlice, fileSignatureLength);
      fileSignatureLength += signatureSlice.length;
    }

    await tempFileHandle.write(bytes);
  };

  const finalizeField = (): void => {
    if (!currentFieldName) {
      throw new AppError('VALIDATION_ERROR', 'Request body must be valid multipart form data', 400);
    }

    fields.set(currentFieldName, textDecoder.decode(concatBytes(fieldChunks, fieldBufferLength)));
    fieldChunks.length = 0;
    fieldBufferLength = 0;
    currentFieldName = undefined;
  };

  const advancePastPartBoundary = (): MultipartParseState | false => {
    if (!startsWithBytes(buffer, partBoundary)) {
      throw new AppError('VALIDATION_ERROR', 'Request body must be valid multipart form data', 400);
    }

    const suffixOffset = partBoundary.length;
    if (buffer.length < suffixOffset + 2) {
      return false;
    }

    const suffix = buffer.subarray(suffixOffset, suffixOffset + 2);
    if (startsWithBytes(suffix, finalBoundarySuffix)) {
      if (buffer.length < suffixOffset + 2) {
        return false;
      }

      if (buffer.length === suffixOffset + 2) {
        consumeBuffer(suffixOffset + 2);
        return 'done';
      }

      if (buffer.length < suffixOffset + 4) {
        return false;
      }

      if (!startsWithBytes(buffer.subarray(suffixOffset + 2, suffixOffset + 4), nextPartSuffix)) {
        throw new AppError('VALIDATION_ERROR', 'Request body must be valid multipart form data', 400);
      }

      consumeBuffer(suffixOffset + 4);
      return 'done';
    }

    if (!startsWithBytes(suffix, nextPartSuffix)) {
      throw new AppError('VALIDATION_ERROR', 'Request body must be valid multipart form data', 400);
    }

    consumeBuffer(suffixOffset + 2);
    return 'headers';
  };

  try {
    for (;;) {
      if (state === 'done') {
        break;
      }

      let madeProgress = false;

      if (state === 'initial-boundary') {
        if (buffer.length > 0 && !matchesPrefixBytes(buffer, initialBoundary) && !startsWithBytes(buffer, initialBoundary)) {
          throw new AppError('VALIDATION_ERROR', 'Request body must be valid multipart form data', 400);
        }

        if (buffer.length >= initialBoundary.length) {
          if (!startsWithBytes(buffer, initialBoundary)) {
            throw new AppError('VALIDATION_ERROR', 'Request body must be valid multipart form data', 400);
          }

          consumeBuffer(initialBoundary.length);
          state = 'headers';
          madeProgress = true;
        }
      }

      if (state === 'headers') {
        const headerIndex = indexOfBytes(buffer, multipartHeaderTerminatorBytes);
        if (headerIndex >= 0) {
          const headerBlock = textDecoder.decode(buffer.subarray(0, headerIndex));
          const headers = parseMultipartPartHeaders(headerBlock);
          consumeBuffer(headerIndex + MULTIPART_HEADER_TERMINATOR.length);
          currentFieldName = headers.name;
          fieldChunks.length = 0;
          fieldBufferLength = 0;

          if (headers.name === 'file') {
            if (fileSeen) {
              throw new AppError('VALIDATION_ERROR', 'Exactly one "file" upload is required', 400);
            }

            fileSeen = true;
            fileName = headers.filename?.trim() || 'upload';
            fileType = headers.contentType || '';
            state = 'file';
          } else {
            state = 'field';
          }

          madeProgress = true;
        } else if (buffer.length > MAX_MULTIPART_ENVELOPE_BYTES) {
          throw new AppError('VALIDATION_ERROR', 'Request body must be valid multipart form data', 400);
        }
      }

      if (state === 'field') {
        const boundaryIndex = indexOfBytes(buffer, partBoundary);
        if (boundaryIndex >= 0) {
          appendFieldBytes(buffer.subarray(0, boundaryIndex));
          consumeBuffer(boundaryIndex);
          finalizeField();
          const nextState = advancePastPartBoundary();
          if (nextState === false) {
            madeProgress = false;
          } else {
            state = nextState;
            madeProgress = true;
          }
        } else if (buffer.length > MAX_MULTIPART_ENVELOPE_BYTES + partBoundary.length) {
          throw new AppError('VALIDATION_ERROR', 'Request body must be valid multipart form data', 400);
        }
      }

      if (state === 'file') {
        const boundaryIndex = indexOfBytes(buffer, partBoundary);
        if (boundaryIndex >= 0) {
          await appendFileBytes(buffer.subarray(0, boundaryIndex));
          consumeBuffer(boundaryIndex);
          const nextState = advancePastPartBoundary();
          if (nextState === false) {
            madeProgress = false;
          } else {
            state = nextState;
            currentFieldName = undefined;
            madeProgress = true;
          }
        } else if (buffer.length > partBoundary.length) {
          const flushLength = buffer.length - (partBoundary.length - 1);
          await appendFileBytes(buffer.subarray(0, flushLength));
          consumeBuffer(flushLength);
          madeProgress = true;
        }
      }

      if (madeProgress) {
        continue;
      }

      const next = await reader.read();
      if (next.done) {
        break;
      }

      appendChunk(next.value);
    }

    if (state === 'done' ? (!fileSeen || buffer.length > 0) : true) {
      await fail(new AppError('VALIDATION_ERROR', 'Request body must be valid multipart form data', 400));
    }
  } catch (error) {
    if (error instanceof AppError) {
      await fail(error);
    }

    try {
      await closeTempFile();
    } catch {
      // Best-effort: the original error remains authoritative.
    }

    try {
      await cleanup();
    } catch {
      // Best-effort: the original error remains authoritative.
    }

    throw error;
  }

  await closeTempFile();

  return {
    fields,
    file: new File([Bun.file(tempFilePath)], fileName, fileType ? { type: fileType } : undefined),
    fileSignature: fileSignature.subarray(0, fileSignatureLength),
    tempFilePath,
    cleanup,
  };
};

const matchesSignature = (bytes: Uint8Array, signature: Uint8Array): boolean =>
  bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);

const sniffImageContentType = (bytes: Uint8Array): string | undefined => {
  if (matchesSignature(bytes, PNG_SIGNATURE)) {
    return 'image/png';
  }

  if (matchesSignature(bytes, JPEG_SIGNATURE)) {
    return 'image/jpeg';
  }

  if (matchesSignature(bytes, GIF87A_SIGNATURE) || matchesSignature(bytes, GIF89A_SIGNATURE)) {
    return 'image/gif';
  }

  if (matchesSignature(bytes, BMP_SIGNATURE)) {
    return 'image/bmp';
  }

  if (
    matchesSignature(bytes, RIFF_SIGNATURE)
    && matchesSignature(bytes.subarray(8), WEBP_SIGNATURE)
  ) {
    return 'image/webp';
  }

  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(4, 8)) === 'ftyp') {
    const brand = String.fromCharCode(...bytes.subarray(8, 12));

    if (AVIF_BRANDS.has(brand)) {
      return 'image/avif';
    }

    if (HEIF_BRANDS.has(brand)) {
      return 'image/heif';
    }
  }

  return undefined;
};

export const parseImageUploadForm = async (
  request: Request,
  config: BetterChatConfig,
): Promise<{
  fields: Map<string, string>;
  file: File;
  text?: string;
  tempFilePath: string;
  cleanup: () => Promise<void>;
}> => {
  let contentLength: number | undefined;
  try {
    contentLength = parseContentLength(request);
  } catch (error) {
    return rejectMultipartRequest(request, toAppError(error));
  }

  if (contentLength !== undefined && contentLength > config.maxUploadBytes + MAX_MULTIPART_ENVELOPE_BYTES) {
    return rejectMultipartRequest(
      request,
      new AppError('VALIDATION_ERROR', `Image upload exceeds the ${config.maxUploadBytes}-byte limit`, 413, {
        maxUploadBytes: config.maxUploadBytes,
      }),
    );
  }

  const upload = await parseMultipartUpload(request, config);

  try {
    if (upload.file.size <= 0) {
      throw new AppError('VALIDATION_ERROR', '"file" must not be empty', 400);
    }

    if (upload.file.size > config.maxUploadBytes) {
      throw new AppError('VALIDATION_ERROR', `Image upload exceeds the ${config.maxUploadBytes}-byte limit`, 413, {
        maxUploadBytes: config.maxUploadBytes,
      });
    }

    if (upload.file.type.length > 0 && !upload.file.type.startsWith('image/')) {
      throw new AppError('VALIDATION_ERROR', '"file" must be an image upload', 400);
    }

    if (!sniffImageContentType(upload.fileSignature)) {
      throw new AppError('VALIDATION_ERROR', '"file" must be an image upload', 400);
    }

    return {
      fields: upload.fields,
      file: upload.file,
      tempFilePath: upload.tempFilePath,
      cleanup: upload.cleanup,
      text: parseOptionalTextField(upload.fields.get('text') ?? null, 'text'),
    };
  } catch (error) {
    try {
      await upload.cleanup();
    } catch {
      // Best-effort: the validation error remains authoritative.
    }

    throw error;
  }
};

export const proxyHeaders = (headers: Headers): Headers => {
  const responseHeaders = new Headers();

  for (const headerName of [
    'accept-ranges',
    'cache-control',
    'content-disposition',
    'content-length',
    'content-range',
    'content-type',
    'etag',
    'last-modified',
  ]) {
    const value = headers.get(headerName);
    if (value) {
      responseHeaders.set(headerName, value);
    }
  }

  return responseHeaders;
};

export const mediaProxyRequestHeaders = (headers: Headers): Headers => {
  const requestHeaders = new Headers();

  for (const headerName of ['if-modified-since', 'if-none-match', 'if-range', 'range']) {
    const value = headers.get(headerName);
    if (value) {
      requestHeaders.set(headerName, value);
    }
  }

  return requestHeaders;
};

export const paginationOptionsFrom = (config: BetterChatConfig, request: Request): PaginationRequest => {
  const searchParams = new URL(request.url).searchParams;

  return parsePaginationRequest(
    {
      cursor: searchParams.get('cursor') || undefined,
      limit: searchParams.get('limit') || undefined,
    },
    {
      defaultLimit: config.defaultMessagePageSize,
      maxLimit: Math.max(config.defaultMessagePageSize, MAX_MESSAGE_PAGE_SIZE),
    },
  );
};

const parseNonNegativeIntegerParam = (
  value: string | null,
  fieldName: string,
  defaultValue: number,
  maxValue: number,
): number => {
  if (value === null) {
    return defaultValue;
  }

  if (!/^\d+$/.test(value)) {
    throw new AppError('VALIDATION_ERROR', `"${fieldName}" must be a non-negative integer when provided`, 400);
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maxValue) {
    throw new AppError('VALIDATION_ERROR', `"${fieldName}" must be between 0 and ${maxValue}`, 400, {
      field: fieldName,
      maxValue,
    });
  }

  return parsed;
};

export const messageContextWindowFrom = (request: Request): { before: number; after: number } => {
  const searchParams = new URL(request.url).searchParams;

  return {
    before: parseNonNegativeIntegerParam(
      searchParams.get('before'),
      'before',
      DEFAULT_CONTEXT_MESSAGES_BEFORE,
      MAX_CONTEXT_MESSAGES,
    ),
    after: parseNonNegativeIntegerParam(
      searchParams.get('after'),
      'after',
      DEFAULT_CONTEXT_MESSAGES_AFTER,
      MAX_CONTEXT_MESSAGES,
    ),
  };
};

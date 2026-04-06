import type {
  CreateConversationMessageRequest,
  MembershipCommandRequest,
  SetReactionRequest,
  UpdateMessageRequest,
} from '@betterchat/contracts';
import type { Hono } from 'hono';

import { conversationCapabilitiesFrom } from '../capabilities';
import { loadConversationAuthorizationContext } from '../conversation-authorization';
import {
  buildConversationMentionCandidates,
  buildConversationParticipantsPage,
} from '../conversation-participants';
import { normalizeConversationMessage } from '../conversation-domain';
import { AppError, toAppError } from '../errors';
import {
  abortUnreadRequestBody,
  messageContextWindowFrom,
  paginationOptionsFrom,
  parseCreateConversationMessageRequest,
  parseImageUploadForm,
  parseMembershipCommandRequest,
  parseOptionalBooleanField,
  parseReactionRequest,
  parseUpdateMessageRequest,
  readJsonBody,
} from '../http-helpers';
import type { AppServices } from '../http-context';
import {
  assertValidConversationReplyTargetMessage,
  assertValidUnreadAnchorMessage,
  getRoomMessage,
  getThreadRootMessage,
  messagePermalinkFrom,
  quoteMessageLinkFromMessage,
  replyPreviewParentMessages,
  threadIdFromMessage,
} from '../message-helpers';
import { parsePaginationRequest } from '../pagination';
import { buildConversationListingMutationResponse, buildFreshConversationSnapshotSync } from '../snapshot-sync';
import { ensureOpenSubscription, getRoomSubscription } from '../snapshots';
import { ensureAuthenticated, normalizeAuthFailure } from '../session-boundary';

const participantPaginationConfig = {
  defaultLimit: 50,
  maxLimit: 100,
} as const;

const mentionCandidatesLimitConfig = {
  defaultLimit: 8,
  maxLimit: 20,
} as const;

const participantPaginationFrom = (request: Request) =>
  parsePaginationRequest(
    {
      cursor: new URL(request.url).searchParams.get('cursor') || undefined,
      limit: new URL(request.url).searchParams.get('limit') || undefined,
    },
    participantPaginationConfig,
  );

const mentionCandidatesLimitFrom = (request: Request): number =>
  parsePaginationRequest(
    {
      limit: new URL(request.url).searchParams.get('limit') || undefined,
    },
    mentionCandidatesLimitConfig,
  ).limit;

const mentionQueryFrom = (request: Request): string => new URL(request.url).searchParams.get('q') || '';

const participantQueryFrom = (request: Request): string | undefined => {
  const value = new URL(request.url).searchParams.get('q')?.trim();
  return value && value.length > 0 ? value : undefined;
};

const parseUploadTarget = (
  fields: Map<string, string>,
): CreateConversationMessageRequest['target'] => {
  const normalizedTargetKind = (fields.get('targetKind') || 'conversation').trim().toLowerCase();
  const replyToMessageId = fields.get('replyToMessageId')?.trim();

  if (normalizedTargetKind === 'conversation') {
    return {
      kind: 'conversation',
      ...(replyToMessageId ? { replyToMessageId } : {}),
    };
  }

  if (normalizedTargetKind === 'thread') {
    const threadId = fields.get('threadId')?.trim();
    if (!threadId) {
      throw new AppError('VALIDATION_ERROR', '"threadId" is required when targetKind is "thread"', 400);
    }

    const echoToConversation = parseOptionalBooleanField(fields.get('echoToConversation') ?? null, 'echoToConversation');
    if (replyToMessageId) {
      throw new AppError('VALIDATION_ERROR', '"replyToMessageId" is not supported for thread media uploads', 400);
    }

    return {
      kind: 'thread',
      threadId,
      ...(echoToConversation !== undefined ? { echoToConversation } : {}),
    };
  }

  throw new AppError('VALIDATION_ERROR', '"targetKind" must be "conversation" or "thread"', 400);
};

const capabilitiesFromAuthorizationContext = (
  context: Awaited<ReturnType<typeof loadConversationAuthorizationContext>>,
) =>
  conversationCapabilitiesFrom(context.room, context.settings, {
    authorization: context.authorization,
    currentUserId: context.currentUserId,
    currentUsername: context.currentUsername,
    subscription: context.subscription,
  });

const hasEnabledMediaMutation = (capabilities: ReturnType<typeof capabilitiesFromAuthorizationContext>): boolean =>
  Object.values(capabilities.mediaMutations).some(Boolean);

const resolveConversationReplyTarget = async (
  client: AppServices['client'],
  session: Parameters<AppServices['client']['getMe']>[0],
  upstreamUrl: string,
  conversationId: string,
  replyToMessageId: string,
): Promise<{
  parentMessageId: string;
  quoteMessageLink: string;
}> => {
  const [roomInfoResponse, parentMessage] = await Promise.all([
    client.getRoomInfo(session, conversationId),
    client.findMessage(session, replyToMessageId),
  ]);
  if (!roomInfoResponse.room) {
    throw new AppError('NOT_FOUND', 'Conversation not found', 404, { conversationId });
  }

  if (!parentMessage || parentMessage.rid !== conversationId) {
    throw new AppError('NOT_FOUND', 'Reply target not found', 404, {
      conversationId,
      messageId: replyToMessageId,
    });
  }

  assertValidConversationReplyTargetMessage(parentMessage, conversationId);

  return {
    parentMessageId: parentMessage._id,
    quoteMessageLink: messagePermalinkFrom(upstreamUrl, roomInfoResponse.room, parentMessage._id),
  };
};

export const installConversationRoutes = (app: Hono, services: AppServices): void => {
  const { client, config, snapshotService } = services;

  app.get('/api/directory', async (c) => {
    const session = ensureAuthenticated(config, c.req.raw);

    try {
      return c.json({
        ok: true,
        data: await snapshotService.directory(session),
      });
    } catch (error) {
      throw normalizeAuthFailure(toAppError(error));
    }
  });

  app.get('/api/conversations/:conversationId', async (c) => {
    const session = ensureAuthenticated(config, c.req.raw);
    const conversationId = c.req.param('conversationId');

    try {
      return c.json({
        ok: true,
        data: await snapshotService.conversation(session, conversationId),
      });
    } catch (error) {
      throw normalizeAuthFailure(toAppError(error));
    }
  });

  app.get('/api/conversations/:conversationId/participants', async (c) => {
    const session = ensureAuthenticated(config, c.req.raw);
    const conversationId = c.req.param('conversationId');
    const page = participantPaginationFrom(c.req.raw);
    const query = participantQueryFrom(c.req.raw);

    try {
      const context = await loadConversationAuthorizationContext(client, session, conversationId);

      return c.json({
        ok: true,
        data: await buildConversationParticipantsPage(client, session, context, page, query),
      });
    } catch (error) {
      throw normalizeAuthFailure(toAppError(error));
    }
  });

  app.get('/api/conversations/:conversationId/mention-candidates', async (c) => {
    const session = ensureAuthenticated(config, c.req.raw);
    const conversationId = c.req.param('conversationId');
    const query = mentionQueryFrom(c.req.raw);
    const limit = mentionCandidatesLimitFrom(c.req.raw);

    try {
      const context = await loadConversationAuthorizationContext(client, session, conversationId);

      return c.json({
        ok: true,
        data: await buildConversationMentionCandidates(client, session, context, query, limit),
      });
    } catch (error) {
      throw normalizeAuthFailure(toAppError(error));
    }
  });

  app.get('/api/conversations/:conversationId/timeline', async (c) => {
    const session = ensureAuthenticated(config, c.req.raw);
    const conversationId = c.req.param('conversationId');
    const page = paginationOptionsFrom(config, c.req.raw);

    try {
      return c.json({
        ok: true,
        data: await snapshotService.conversationTimeline(session, conversationId, page),
      });
    } catch (error) {
      throw normalizeAuthFailure(toAppError(error));
    }
  });

  app.get('/api/conversations/:conversationId/messages/:messageId/context', async (c) => {
    const session = ensureAuthenticated(config, c.req.raw);
    const conversationId = c.req.param('conversationId');
    const messageId = c.req.param('messageId');
    const contextWindow = messageContextWindowFrom(c.req.raw);

    try {
      return c.json({
        ok: true,
        data: await snapshotService.conversationMessageContext(session, conversationId, messageId, contextWindow),
      });
    } catch (error) {
      throw normalizeAuthFailure(toAppError(error));
    }
  });

  app.get('/api/conversations/:conversationId/threads/:threadId/timeline', async (c) => {
    const session = ensureAuthenticated(config, c.req.raw);
    const conversationId = c.req.param('conversationId');
    const threadId = c.req.param('threadId');
    const page = paginationOptionsFrom(config, c.req.raw);

    try {
      return c.json({
        ok: true,
        data: await snapshotService.threadConversationTimeline(session, conversationId, threadId, page),
      });
    } catch (error) {
      throw normalizeAuthFailure(toAppError(error));
    }
  });

  app.post('/api/conversations/:conversationId/messages', async (c) => {
    const session = ensureAuthenticated(config, c.req.raw);
    const conversationId = c.req.param('conversationId');
    const body = parseCreateConversationMessageRequest(await readJsonBody<CreateConversationMessageRequest>(c.req.raw));

    try {
      const authorizationContext = await loadConversationAuthorizationContext(client, session, conversationId);
      const capabilities = capabilitiesFromAuthorizationContext(authorizationContext);

      let response;
      if (body.target.kind === 'conversation') {
        let quoteMessageLink: string | undefined;
        let parentMessageId: string | undefined;

        if (body.target.replyToMessageId) {
          if (!capabilities.messageMutations.conversationReply) {
            throw new AppError('UPSTREAM_REJECTED', 'Conversation does not allow reply messages', 403, {
              conversationId,
              messageId: body.target.replyToMessageId,
            });
          }

          ({ parentMessageId, quoteMessageLink } = await resolveConversationReplyTarget(
            client,
            session,
            config.upstreamUrl,
            conversationId,
            body.target.replyToMessageId,
          ));
        } else if (!capabilities.messageMutations.conversation) {
          throw new AppError('UPSTREAM_REJECTED', 'Conversation does not allow sending messages', 403, {
            conversationId,
          });
        }

        response = await client.sendRoomMessage(session, {
          ...(body.submissionId ? { messageId: body.submissionId } : {}),
          roomId: conversationId,
          text: body.content.text,
          ...(quoteMessageLink ? { quoteMessageLink } : {}),
        });

        if (parentMessageId) {
          body.target.replyToMessageId = parentMessageId;
        }
      } else {
        const threadSendAllowed = body.target.echoToConversation === true
          ? capabilities.messageMutations.threadEchoToConversation
          : capabilities.messageMutations.thread;
        if (!threadSendAllowed) {
          throw new AppError('UPSTREAM_REJECTED', 'Thread replies are not allowed in this conversation', 403, {
            conversationId,
            threadId: body.target.threadId,
          });
        }

        await getThreadRootMessage(client, session, conversationId, body.target.threadId);
        response = await client.sendThreadMessage(session, {
          ...(body.submissionId ? { messageId: body.submissionId } : {}),
          roomId: conversationId,
          threadId: body.target.threadId,
          text: body.content.text,
          broadcastToRoom: body.target.echoToConversation ?? false,
        });
      }

      if (!authorizationContext.subscription.open) {
        await ensureOpenSubscription(client, session, conversationId);
      }

      snapshotService.observeMessage(response.message);
      const parentMessages = await replyPreviewParentMessages(
        client,
        session,
        body.target.kind === 'conversation' ? body.target.replyToMessageId : body.target.threadId,
      );
      const normalizedMessage = normalizeConversationMessage(
        config.upstreamUrl,
        response.message,
        parentMessages,
        authorizationContext,
      );

      return c.json({
        ok: true,
        data: {
          message: body.submissionId ? { ...normalizedMessage, submissionId: body.submissionId } : normalizedMessage,
        },
      });
    } catch (error) {
      throw normalizeAuthFailure(toAppError(error));
    }
  });

  app.patch('/api/conversations/:conversationId/messages/:messageId', async (c) => {
    const session = ensureAuthenticated(config, c.req.raw);
    const conversationId = c.req.param('conversationId');
    const messageId = c.req.param('messageId');
    const body = parseUpdateMessageRequest(await readJsonBody<UpdateMessageRequest>(c.req.raw));

    try {
      const authorizationContext = await loadConversationAuthorizationContext(client, session, conversationId);
      const currentMessage = await getRoomMessage(client, session, conversationId, messageId);
      snapshotService.observeMessage(currentMessage);
      let quoteMessageLink: string | undefined;

      if (currentMessage.tmid && body.replyToMessageId !== undefined) {
        throw new AppError('VALIDATION_ERROR', '"replyToMessageId" is not supported when editing thread replies', 400, {
          conversationId,
          messageId,
        });
      }

      if (body.replyToMessageId === undefined) {
        quoteMessageLink = quoteMessageLinkFromMessage(currentMessage);
      } else if (body.replyToMessageId !== null) {
        if (!capabilitiesFromAuthorizationContext(authorizationContext).messageMutations.conversationReply) {
          throw new AppError('UPSTREAM_REJECTED', 'Conversation does not allow reply messages', 403, {
            conversationId,
            messageId,
            replyToMessageId: body.replyToMessageId,
          });
        }

        ({ quoteMessageLink } = await resolveConversationReplyTarget(
          client,
          session,
          config.upstreamUrl,
          conversationId,
          body.replyToMessageId,
        ));
      }

      const response = await client.updateMessage(session, {
        roomId: conversationId,
        messageId,
        text: body.text,
        ...(quoteMessageLink ? { quoteMessageLink } : {}),
      });
      snapshotService.observeMessage(response.message);
      const parentMessages = await replyPreviewParentMessages(client, session, response.message.tmid);
      const sync = await buildFreshConversationSnapshotSync(snapshotService, session, conversationId, {
        includeDirectory: true,
        includeConversation: true,
        includeTimeline: true,
        threadId: threadIdFromMessage(response.message),
      });

      return c.json({
        ok: true,
        data: {
          message: normalizeConversationMessage(config.upstreamUrl, response.message, parentMessages, authorizationContext),
          sync,
        },
      });
    } catch (error) {
      throw normalizeAuthFailure(toAppError(error));
    }
  });

  app.delete('/api/conversations/:conversationId/messages/:messageId', async (c) => {
    const session = ensureAuthenticated(config, c.req.raw);
    const conversationId = c.req.param('conversationId');
    const messageId = c.req.param('messageId');

    try {
      const message = await getRoomMessage(client, session, conversationId, messageId);
      snapshotService.observeMessage(message);

      await client.deleteMessage(session, {
        roomId: conversationId,
        messageId,
      });
      snapshotService.rememberDeletedMessage(message);
      const sync = await buildFreshConversationSnapshotSync(snapshotService, session, conversationId, {
        includeDirectory: true,
        includeConversation: true,
        includeTimeline: true,
        threadId: threadIdFromMessage(message),
      });

      return c.json({
        ok: true,
        data: {
          messageId,
          sync,
        },
      });
    } catch (error) {
      throw normalizeAuthFailure(toAppError(error));
    }
  });

  app.post('/api/conversations/:conversationId/messages/:messageId/reactions', async (c) => {
    const session = ensureAuthenticated(config, c.req.raw);
    const conversationId = c.req.param('conversationId');
    const messageId = c.req.param('messageId');
    const body = parseReactionRequest(await readJsonBody<SetReactionRequest>(c.req.raw));

    try {
      const authorizationContext = await loadConversationAuthorizationContext(client, session, conversationId);
      await getRoomMessage(client, session, conversationId, messageId);

      await client.setReaction(session, {
        messageId,
        emoji: body.emoji,
        shouldReact: body.shouldReact,
      });
      const updatedMessage = await client.findMessage(session, messageId);
      if (!updatedMessage) {
        throw new AppError('NOT_FOUND', 'Message not found after reaction update', 404, {
          conversationId,
          messageId,
        });
      }
      snapshotService.observeMessage(updatedMessage);

      const parentMessages = await replyPreviewParentMessages(client, session, updatedMessage.tmid);
      const normalizedMessage = normalizeConversationMessage(
        config.upstreamUrl,
        updatedMessage,
        parentMessages,
        authorizationContext,
      );
      const sync = await buildFreshConversationSnapshotSync(snapshotService, session, conversationId, {
        includeDirectory: true,
        includeConversation: true,
        includeTimeline: true,
        threadId: threadIdFromMessage(updatedMessage),
      });

      return c.json({
        ok: true,
        data: {
          messageId,
          reactions: normalizedMessage.reactions,
          sync,
        },
      });
    } catch (error) {
      throw normalizeAuthFailure(toAppError(error));
    }
  });

  app.post('/api/conversations/:conversationId/media', async (c) => {
    const session = ensureAuthenticated(config, c.req.raw);
    const conversationId = c.req.param('conversationId');
    let authorizationContext: Awaited<ReturnType<typeof loadConversationAuthorizationContext>>;
    let capabilities: ReturnType<typeof capabilitiesFromAuthorizationContext>;

    try {
      try {
        authorizationContext = await loadConversationAuthorizationContext(client, session, conversationId);
        capabilities = capabilitiesFromAuthorizationContext(authorizationContext);

        if (!hasEnabledMediaMutation(capabilities)) {
          throw new AppError('UPSTREAM_REJECTED', 'Conversation does not allow media uploads', 403, {
            conversationId,
          });
        }
      } catch (error) {
        abortUnreadRequestBody(c.req.raw);
        throw error;
      }

      const upload = await parseImageUploadForm(c.req.raw, config);

      try {
        const target = parseUploadTarget(upload.fields);
        let quoteMessageLink: string | undefined;
        let parentMessageId: string | undefined;

        if (target.kind === 'conversation') {
          const mediaSendAllowed = target.replyToMessageId
            ? capabilities.mediaMutations.conversationReply
            : capabilities.mediaMutations.conversation;
          if (!mediaSendAllowed) {
            throw new AppError('UPSTREAM_REJECTED', 'Conversation does not allow media uploads', 403, {
              conversationId,
              ...(target.replyToMessageId ? { messageId: target.replyToMessageId } : {}),
            });
          }

          if (target.replyToMessageId) {
            ({ parentMessageId, quoteMessageLink } = await resolveConversationReplyTarget(
              client,
              session,
              config.upstreamUrl,
              conversationId,
              target.replyToMessageId,
            ));
          }
        }

        if (target.kind === 'thread') {
          const mediaThreadAllowed = target.echoToConversation === true
            ? capabilities.mediaMutations.threadEchoToConversation
            : capabilities.mediaMutations.thread;
          if (!mediaThreadAllowed) {
            throw new AppError('UPSTREAM_REJECTED', 'Thread replies are not allowed in this conversation', 403, {
              conversationId,
              threadId: target.threadId,
            });
          }

          await getThreadRootMessage(client, session, conversationId, target.threadId);
        }

        const uploaded = await client.uploadRoomMedia(session, conversationId, upload.file);
        let confirmed;

        try {
          confirmed = await client.confirmRoomMedia(session, {
            roomId: conversationId,
            fileId: uploaded.file._id,
            ...(upload.text ? { text: upload.text } : {}),
            ...(quoteMessageLink ? { quoteMessageLink } : {}),
            ...(target.kind === 'thread' ? { threadId: target.threadId, broadcastToRoom: target.echoToConversation ?? false } : {}),
          });
        } catch (error) {
          await client.deleteTemporaryUpload(session, uploaded.file._id).catch(() => undefined);
          throw error;
        }

        if (!authorizationContext.subscription.open) {
          await ensureOpenSubscription(client, session, conversationId);
        }

        snapshotService.observeMessage(confirmed.message);
        const parentMessages = await replyPreviewParentMessages(
          client,
          session,
          target.kind === 'conversation' ? parentMessageId : target.threadId,
        );
        return c.json({
          ok: true,
          data: {
            message: normalizeConversationMessage(config.upstreamUrl, confirmed.message, parentMessages, authorizationContext),
          },
        });
      } finally {
        await upload.cleanup().catch(() => undefined);
      }
    } catch (error) {
      throw normalizeAuthFailure(toAppError(error));
    }
  });

  app.post('/api/conversations/:conversationId/membership/commands', async (c) => {
    const session = ensureAuthenticated(config, c.req.raw);
    const conversationId = c.req.param('conversationId');
    const body = parseMembershipCommandRequest(await readJsonBody<MembershipCommandRequest>(c.req.raw));

    try {
      await getRoomSubscription(client, session, conversationId);

      switch (body.type) {
        case 'set-starred':
          await client.setRoomFavorite(session, conversationId, body.value);
          break;
        case 'set-listing':
          {
            const result = await buildConversationListingMutationResponse(
              snapshotService,
              client,
              session,
              conversationId,
              body.value,
            );

          return c.json({
            ok: true,
            data: {
              conversationId: result.conversationId,
              sync: result.sync,
            },
          });
          }
        case 'mark-read':
          await client.markRoomRead(session, {
            roomId: conversationId,
            readThreads: body.includeThreads,
          });
          break;
        case 'mark-unread':
          if (body.fromMessageId) {
            const anchorMessage = await getRoomMessage(client, session, conversationId, body.fromMessageId);
            assertValidUnreadAnchorMessage(anchorMessage, session, conversationId);
          }

          await client.markRoomUnread(session, {
            roomId: conversationId,
            firstUnreadMessageId: body.fromMessageId,
          });
          break;
      }

      return c.json({
        ok: true,
        data: {
          conversationId,
          sync: await buildFreshConversationSnapshotSync(snapshotService, session, conversationId, {
            includeDirectory: true,
            includeConversation: true,
            includeTimeline: true,
          }),
        },
      });
    } catch (error) {
      throw normalizeAuthFailure(toAppError(error));
    }
  });
};

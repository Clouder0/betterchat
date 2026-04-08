import type {
	ConversationCapabilities,
	ConversationKind,
	ConversationLiveState,
	ConversationMentionCandidate,
	ConversationMentionCandidatesResponse,
	ConversationMessage,
	ConversationMessageContextSnapshot,
	ConversationMessageReference,
	ConversationParticipant,
	ConversationParticipantsPage,
	ConversationSnapshot,
	ConversationTimelineSnapshot,
	CreateConversationMessageRequest,
	CreateConversationMessageResponse,
	DeleteMessageResponse,
	DirectoryEntry,
	DirectorySnapshot,
	DirectConversationLookup,
	EnsureDirectConversationResponse,
	LoginRequest,
	LoginResponse,
	MembershipCommandRequest,
	MembershipCommandResponse,
	PresenceState,
	PublicBootstrap,
	SessionUser,
	UpdateMessageRequest,
	UpdateMessageResponse,
	UserSummary,
	WorkspaceBootstrap,
} from '@betterchat/contracts';
import type {
	RoomSnapshot,
	RoomSummary,
	TimelineMessage,
} from '@/lib/chatModels';

import { createReplyPreviewFromMessage } from '@/features/messages/messageCompose';
import { toTimelineMessage } from '@/lib/chatAdapters';

const FIXTURE_SESSION_STORAGE_KEY = 'betterchat.fixture.session';
const FIXTURE_FAIL_NEXT_IMAGE_UPLOAD_STORAGE_KEY = 'betterchat.fixture.fail-next-image-upload';
const FIXTURE_FAIL_IMAGE_UPLOAD_ALWAYS_STORAGE_KEY = 'betterchat.fixture.fail-image-upload-always';
const FIXTURE_TIMELINE_PAGE_SIZE = 50;

type FixtureSidebarEntry = {
	roomId: string;
	kind: RoomSummary['kind'];
	title: string;
	subtitle?: string;
	avatarUrl?: string;
	favorite: boolean;
	unreadCount: number;
	mentioned: boolean;
	open: boolean;
	lastActivityAt?: string;
};
type FixtureSidebarState = {
	entries: FixtureSidebarEntry[];
};
type FixtureRoomDetails = {
	id: string;
	kind: RoomSummary['kind'];
	title: string;
	topic?: string;
	description?: string;
	memberCount?: number;
	announcement?: string;
	favorite: boolean;
	readOnly?: boolean;
	unreadCount: number;
};
type FixtureRoomTimeline = {
	room: {
		id: string;
		title: string;
		kind: RoomSummary['kind'];
	};
	messages: TimelineMessage[];
	unreadFromMessageId?: string;
};
type FixtureTimelineRequestOptions = {
	cursor?: string;
	limit?: number;
};

type FixtureKnownUser = {
	id: string;
	username: string;
	displayName: string;
	presence: PresenceState;
	existingConversationId?: string;
	aliases?: string[];
};

const demoUser: SessionUser = {
	id: 'user-linche',
	username: 'linche',
	displayName: '林澈',
	status: 'online',
};

const publicBootstrap: PublicBootstrap = {
	server: {
		version: '7.6.0',
		siteName: '北域协作',
	},
	session: {
		authenticated: false,
	},
	login: {
		passwordEnabled: true,
		registeredProviders: [
			{ name: 'oidc', label: '企业单点登录' },
			{ name: 'github', label: 'GitHub' },
		],
	},
	features: {
		registerEnabled: false,
	},
};

const workspaceBootstrap = (currentUser: SessionUser): WorkspaceBootstrap => ({
	currentUser,
	workspace: {
		name: '北域协作',
		version: 'Rocket.Chat 7.6.0',
	},
	capabilities: {
		canSendMessages: true,
		canUploadImages: true,
		realtimeEnabled: false,
	},
});

const fixturePresenceByLabel = {
	在线: 'online',
	离开: 'away',
	忙碌: 'busy',
	离线: 'offline',
} as const satisfies Record<string, RoomSummary['presence']>;

const fixturePresenceFromSubtitle = (subtitle: string | undefined): RoomSummary['presence'] | undefined => {
	if (!subtitle) {
		return undefined;
	}

	const match = subtitle.match(/(?:^|[\s·•・])(在线|离开|忙碌|离线)$/u);
	if (!match) {
		return undefined;
	}

	return fixturePresenceByLabel[match[1] as keyof typeof fixturePresenceByLabel];
};

const toFixtureAttention = ({
	mentioned,
	unreadCount,
}: {
	mentioned: boolean;
	unreadCount: number;
}): RoomSummary['attention'] => {
	if (mentioned) {
		return {
			level: 'mention',
			...(unreadCount > 0 ? { badgeCount: unreadCount } : {}),
		};
	}

	if (unreadCount > 0) {
		return {
			level: 'unread',
			badgeCount: unreadCount,
		};
	}

	return {
		level: 'none',
	};
};

const toRoomSummary = (entry: FixtureSidebarEntry): RoomSummary => ({
	id: entry.roomId,
	kind: entry.kind,
	title: entry.title,
	subtitle: entry.subtitle,
	presence: entry.kind === 'dm' ? fixturePresenceFromSubtitle(entry.subtitle) : undefined,
	avatarUrl: entry.avatarUrl,
	favorite: entry.favorite,
	visibility: entry.open ? 'visible' : 'hidden',
	attention: toFixtureAttention({
		mentioned: entry.mentioned,
		unreadCount: entry.unreadCount,
	}),
	lastActivityAt: entry.lastActivityAt,
});

const roomCapabilities = {
	canSendMessages: true,
	canUploadImages: true,
	canFavorite: true,
	canChangeVisibility: true,
} satisfies RoomSnapshot['room']['capabilities'];

const toRoomSnapshot = ({
	roomDetails,
	sidebarEntry,
}: {
	roomDetails: FixtureRoomDetails;
	sidebarEntry: FixtureSidebarEntry;
}): RoomSnapshot['room'] => ({
	...toRoomSummary(sidebarEntry),
	topic: roomDetails.topic,
	description: roomDetails.description,
	memberCount: roomDetails.memberCount,
	announcement: roomDetails.announcement,
	capabilities: roomCapabilities,
});

const sidebarResponse: FixtureSidebarState = {
	entries: [
		{
			roomId: 'ops-handoff',
			kind: 'channel',
			title: '运营协调',
			subtitle: '交接说明与排班同步',
			favorite: true,
			unreadCount: 4,
			mentioned: true,
			open: true,
			lastActivityAt: '2026-03-25T09:26:00.000Z',
		},
		{
			roomId: 'dm-mia',
			kind: 'dm',
			title: 'Mia 张',
			subtitle: '设计评审 · 离开',
			favorite: true,
			unreadCount: 1,
			mentioned: false,
			open: true,
			lastActivityAt: '2026-03-25T09:18:00.000Z',
		},
		{
			roomId: 'platform-duty',
			kind: 'group',
			title: 'Platform 值班',
			subtitle: '接口验证进行中',
			favorite: false,
			unreadCount: 2,
			mentioned: false,
			open: true,
			lastActivityAt: '2026-03-25T09:22:00.000Z',
		},
		{
			roomId: 'compat-lab',
			kind: 'channel',
			title: 'Rocket.Chat 兼容',
			subtitle: '7.6.0 验证',
			favorite: false,
			unreadCount: 0,
			mentioned: false,
			open: true,
			lastActivityAt: '2026-03-25T08:58:00.000Z',
		},
		{
			roomId: 'readonly-updates',
			kind: 'channel',
			title: '只读公告',
			subtitle: '发布说明与制度同步',
			favorite: false,
			unreadCount: 0,
			mentioned: false,
			open: true,
			lastActivityAt: '2026-03-25T08:46:00.000Z',
		},
		{
			roomId: 'delivery-room',
			kind: 'channel',
			title: '客户交付',
			subtitle: '17:30 前确认交接结论',
			favorite: false,
			unreadCount: 6,
			mentioned: false,
			open: true,
			lastActivityAt: '2026-03-25T09:20:00.000Z',
		},
		{
			roomId: 'history-archive',
			kind: 'channel',
			title: '历史归档',
			subtitle: '长消息流分页验证',
			favorite: false,
			unreadCount: 0,
			mentioned: false,
			open: true,
			lastActivityAt: '2026-03-24T10:49:00.000Z',
		},
		{
			roomId: 'dm-zhoulan',
			kind: 'dm',
			title: '周岚',
			subtitle: '平台同学 · 在线',
			favorite: false,
			unreadCount: 0,
			mentioned: false,
			open: true,
			lastActivityAt: '2026-03-25T08:42:00.000Z',
		},
		{
			roomId: 'dm-guning',
			kind: 'dm',
			title: '顾宁',
			subtitle: '交付协同 · 忙碌',
			favorite: false,
			unreadCount: 3,
			mentioned: false,
			open: true,
			lastActivityAt: '2026-03-25T09:24:00.000Z',
		},
		{
			roomId: 'dm-achen',
			kind: 'dm',
			title: 'Alexander Chen',
			subtitle: '基础架构 · 离线',
			favorite: false,
			unreadCount: 0,
			mentioned: false,
			open: true,
			lastActivityAt: '2026-03-25T07:58:00.000Z',
		},
	],
};

const roomDetailsMap: Record<string, FixtureRoomDetails> = {
	'ops-handoff': {
		id: 'ops-handoff',
		kind: 'channel',
		title: '运营协调',
		topic: 'Rocket.Chat 7.6.0 兼容与 BetterChat 第一阶段交接',
		description: '围绕房间列表、消息流、交接节奏与上线准备做同步。',
		memberCount: 18,
		announcement: '今天先把读和跳转做顺，发送与实时留到后续切片。',
		favorite: true,
		unreadCount: 4,
	},
	'platform-duty': {
		id: 'platform-duty',
		kind: 'group',
		title: 'Platform 值班',
		topic: '接口验证、错误归因、值班交接',
		description: '平台值班小组内部同步。',
		memberCount: 9,
		announcement: '注意 Rocket.Chat 7.6.0 的历史消息与 rooms.open 语义。',
		favorite: false,
		unreadCount: 2,
	},
	'compat-lab': {
		id: 'compat-lab',
		kind: 'channel',
		title: 'Rocket.Chat 兼容',
		topic: '公开兼容清单与验证结论',
		description: '收敛 BetterChat 与上游 7.6.0 的行为边界。',
		memberCount: 13,
		favorite: false,
		unreadCount: 0,
	},
	'readonly-updates': {
		id: 'readonly-updates',
		kind: 'channel',
		title: '只读公告',
		topic: '仅用于发布固定说明，不接受直接回复',
		description: '用于验证只读房间应该切换为只读提示，而不是保留完整发送框。',
		memberCount: 31,
		announcement: '该房间仅发布统一说明。',
		favorite: false,
		readOnly: true,
		unreadCount: 0,
	},
	'delivery-room': {
		id: 'delivery-room',
		kind: 'channel',
		title: '客户交付',
		topic: '交付前信息确认与节奏对齐',
		description: '偏长说明与决策结论较多的频道。',
		memberCount: 24,
		announcement: '先看结论，再追细节。',
		favorite: false,
		unreadCount: 6,
	},
	'history-archive': {
		id: 'history-archive',
		kind: 'channel',
		title: '历史归档',
		topic: '用于验证时间线历史分页与向上加载',
		description: '包含足够长的时间线数据，用于回归无限滚动与视口锚点保持。',
		memberCount: 12,
		announcement: '这个房间专门给前端分页与滚动行为做回归验证。',
		favorite: false,
		unreadCount: 0,
	},
	'dm-mia': {
		id: 'dm-mia',
		kind: 'dm',
		title: 'Mia 张',
		description: '设计评审与页面密度讨论。',
		memberCount: 2,
		favorite: true,
		unreadCount: 1,
	},
	'dm-zhoulan': {
		id: 'dm-zhoulan',
		kind: 'dm',
		title: '周岚',
		description: '平台细节与接口摸底。',
		memberCount: 2,
		favorite: false,
		unreadCount: 0,
	},
	'dm-guning': {
		id: 'dm-guning',
		kind: 'dm',
		title: '顾宁',
		description: '交付节奏与内容裁剪。',
		memberCount: 2,
		favorite: false,
		unreadCount: 3,
	},
	'dm-achen': {
		id: 'dm-achen',
		kind: 'dm',
		title: 'Alexander Chen',
		description: '基础架构与接口边界。',
		memberCount: 2,
		favorite: false,
		unreadCount: 0,
	},
};

const fixtureKnownUsers: readonly FixtureKnownUser[] = [
	{
		id: 'user-mia',
		username: 'mia',
		displayName: 'Mia 张',
		presence: 'away',
		existingConversationId: 'dm-mia',
	},
	{
		id: 'user-zhoulan',
		username: 'zhoulan',
		displayName: '周岚',
		presence: 'online',
		existingConversationId: 'dm-zhoulan',
		aliases: ['user-zhou'],
	},
	{
		id: 'user-guning',
		username: 'guning',
		displayName: '顾宁',
		presence: 'busy',
		existingConversationId: 'dm-guning',
		aliases: ['user-gu'],
	},
	{
		id: 'user-achen',
		username: 'achen',
		displayName: 'Alexander Chen',
		presence: 'offline',
		existingConversationId: 'dm-achen',
		aliases: ['user-chen'],
	},
	{
		id: 'user-ouyang',
		username: 'mingyuan',
		displayName: '欧阳明远',
		presence: 'online',
	},
];

const fixtureParticipantUserIdsByRoomId = {
	'ops-handoff': [demoUser.id, 'user-ouyang', 'user-zhoulan', 'user-mia', 'user-guning', 'user-achen'],
	'platform-duty': [demoUser.id, 'user-ouyang', 'user-zhoulan', 'user-mia', 'user-guning', 'user-achen'],
	'compat-lab': [demoUser.id, 'user-ouyang', 'user-zhoulan', 'user-mia'],
	'readonly-updates': [demoUser.id, 'user-ouyang', 'user-zhoulan'],
	'delivery-room': [demoUser.id, 'user-ouyang', 'user-mia', 'user-guning'],
	'history-archive': [demoUser.id, 'user-zhoulan', 'user-mia', 'user-guning'],
	'dm-mia': [demoUser.id, 'user-mia'],
	'dm-zhoulan': [demoUser.id, 'user-zhoulan'],
	'dm-guning': [demoUser.id, 'user-guning'],
	'dm-achen': [demoUser.id, 'user-achen'],
} as const satisfies Record<string, string[]>;

const message = (message: TimelineMessage): TimelineMessage => message;
const historyArchiveAuthors = [
	{ id: 'user-zhoulan', displayName: '周岚', username: 'zhoulan' },
	{ id: 'user-mia', displayName: 'Mia 张', username: 'mia' },
	{ id: 'user-guning', displayName: '顾宁', username: 'guning' },
] as const;
const createHistoryArchiveMarkdown = (sequence: number) => {
	if (sequence % 29 === 0) {
		return `历史分页回归消息 ${sequence}

这一页故意放一段更重的技术内容，验证 older prepend 后长消息的折叠、测量与阅读锚点不会互相打架。

\`\`\`ts
const historyProbe = {
  id: ${sequence},
  mode: 'prepend-stability',
  expectations: [
    'anchor-keeps-reading-position',
    'no-late-rebound-after-reflow',
    'long-block-measurement-stays-quiet',
  ],
};

historyProbe.expectations.forEach((expectation) => {
  console.log(sequence, expectation);
});
\`\`\`

如果这类消息一进来就让视口晃一下，说明 prepend restore 和 content reflow 还没有真正拆开。`;
	}

	if (sequence % 17 === 0) {
		return `历史分页回归消息 ${sequence}

> 这里再放一段更长的引用块，用来确认 older page 拼接以后，引用、段落、折叠渐变与阅读位置仍然稳定。
>
> 目标不是“看起来大概没问题”，而是即使长消息晚一点完成测量，也不能把用户已经停住的视口再拉走。

用于验证向上滚动时 older page 能被稳定拼接，且当前阅读位置不会跳动。`;
	}

	return `历史分页回归消息 ${sequence}\n\n用于验证向上滚动时 older page 能被稳定拼接，且当前阅读位置不会跳动。`;
};
const historyArchiveMessages = Array.from({ length: 110 }, (_value, index) => {
	const sequence = index + 1;
	const author = historyArchiveAuthors[index % historyArchiveAuthors.length] ?? historyArchiveAuthors[0];
	return message({
		id: `history-${String(sequence).padStart(3, '0')}`,
		roomId: 'history-archive',
		createdAt: new Date(Date.UTC(2026, 2, 24, 9, index, 0)).toISOString(),
		author: { ...author },
		body: {
			rawMarkdown: createHistoryArchiveMarkdown(sequence),
		},
		flags: { edited: false, deleted: false },
	});
});

const timelineMap: Record<string, FixtureRoomTimeline> = {
	'ops-handoff': {
		room: {
			id: 'ops-handoff',
			title: '运营协调',
			kind: 'channel',
		},
		messages: [
			message({
				id: 'ops-001',
				roomId: 'ops-handoff',
				createdAt: '2026-03-25T08:11:00.000Z',
				author: { id: 'user-chen', displayName: 'Alexander Chen', username: 'achen' },
				body: {
					rawMarkdown:
						'先记个起点：这一轮 BetterChat 第一目标不是堆功能，而是把 **登录、侧栏、房间打开、消息阅读** 这条链路做顺。',
				},
				flags: { edited: false, deleted: false },
			}),
			message({
				id: 'ops-002',
				roomId: 'ops-handoff',
				createdAt: '2026-03-25T08:19:00.000Z',
				author: { id: 'user-ouyang', displayName: '欧阳明远', username: 'mingyuan' },
				body: {
					rawMarkdown: `补一个较长的同步说明，确认长消息也能稳稳落在主消息流里：

- 先验证 Rocket.Chat 7.6.0 的登录与 bootstrap
- 再处理 rooms / subscriptions 的列表归一化
- 最后收敛消息渲染、引用和图片

如果高峰时段需要解释等待为何恶化，频道里也可能直接写成 $W_q \\approx \\frac{\\rho}{\\mu(1-\\rho)}$。真正重要的是，公式出现之后界面仍然像产品，而不是像拼进去的插件。`,
				},
				flags: { edited: false, deleted: false },
				thread: { replyCount: 2, lastReplyAt: '2026-03-25T09:09:00.000Z' },
			}),
			message({
				id: 'ops-003',
				roomId: 'ops-handoff',
				createdAt: '2026-03-25T08:53:00.000Z',
				author: { id: 'user-mia', displayName: 'Mia 张', username: 'mia' },
				body: {
					rawMarkdown: `我同意，右侧补充面板应该只承担上下文，而不是第二个 dashboard。

> 时间线先保持阅读秩序，再谈更重的互动。`,
				},
				flags: { edited: false, deleted: false },
				replyTo: {
					messageId: 'ops-002',
					authorName: '欧阳明远',
					excerpt:
						'补一个较长的同步说明，确认长消息也能稳稳落在主消息流里：先验证 Rocket.Chat 7.6.0 的登录与 bootstrap，再处理 rooms / subscriptions 的列表归一化。',
					long: true,
				},
			}),
			message({
				id: 'ops-004',
				roomId: 'ops-handoff',
				createdAt: '2026-03-25T09:02:00.000Z',
				author: { id: 'user-zhou', displayName: '周岚', username: 'zhoulan' },
				body: {
					rawMarkdown: `顺手把接口草稿也贴进来，确认代码块和正文是同一套语气：

\`\`\`ts
const snapshot = {
  room: 'ops-handoff',
  unreadFirst: true,
  richContent: ['markdown', 'math', 'image'],
};
\`\`\`

如果这类技术内容一出现就像换了另一个产品，说明视觉纪律还不够稳。`,
				},
				flags: { edited: false, deleted: false },
			}),
			message({
				id: 'ops-005',
				roomId: 'ops-handoff',
				createdAt: '2026-03-25T09:09:00.000Z',
				author: { id: 'user-gu', displayName: '顾宁', username: 'guning' },
				body: {
					rawMarkdown: `@linche 再补一张图，也请 @zhoulan 一起确认 markdown 图片与附件图片都能用同一套界面语言承接：

![兼容流程示意图](/api/media/fixtures/compat-flow.svg)

下面再挂一张附件图，检查大图在消息流里是否仍然低噪。`,
				},
				flags: { edited: false, deleted: false },
				attachments: [
					{
						kind: 'image',
						id: 'ops-005-image',
						title: '交接结构图',
						preview: {
							url: '/api/media/fixtures/ops-handoff-board-preview.svg',
							width: 480,
							height: 480,
						},
						source: {
							url: '/api/media/fixtures/ops-handoff-board.svg',
						},
					},
				],
			}),
			message({
				id: 'ops-006',
				roomId: 'ops-handoff',
				createdAt: '2026-03-25T09:14:00.000Z',
				author: { id: 'user-linche', displayName: '林澈', username: 'linche' },
				body: {
					rawMarkdown: `为了避免 generic dashboard drift，侧栏的重点只放三件事：**收藏、房间、私信**。搜索先做简单可用，中文匹配自然成立就够。`,
				},
				flags: { edited: false, deleted: false },
				replyTo: {
					messageId: 'ops-004',
					authorName: '周岚',
					excerpt: '顺手把接口草稿也贴进来，确认代码块和正文是同一套语气。',
					long: false,
				},
			}),
		],
		unreadFromMessageId: 'ops-003',
	},
	'platform-duty': {
		room: {
			id: 'platform-duty',
			title: 'Platform 值班',
			kind: 'group',
		},
		messages: [
			message({
				id: 'platform-000',
				roomId: 'platform-duty',
				createdAt: '2026-03-25T08:08:00.000Z',
				author: { id: 'user-ouyang', displayName: '欧阳明远', username: 'mingyuan' },
				body: {
					rawMarkdown: `先把值班链路写清楚，后面压测和联调时就不容易误判：

- rooms.open / rooms.hide 要跟订阅状态一起看
- sidebar 只认 BetterChat 合同层
- 历史消息与实时增量要能在同一条时间线上并存`,
				},
				flags: { edited: false, deleted: false },
			}),
			message({
				id: 'platform-000b',
				roomId: 'platform-duty',
				createdAt: '2026-03-25T08:21:00.000Z',
				author: { id: 'user-gu', displayName: '顾宁', username: 'guning' },
				body: {
					rawMarkdown:
						'另外记一下：值班群里的未读锚点要稳，不然一旦切房间再回来，阅读秩序就会被打断。',
				},
				flags: { edited: false, deleted: false },
			}),
			message({
				id: 'platform-001',
				roomId: 'platform-duty',
				createdAt: '2026-03-25T08:33:00.000Z',
				author: { id: 'user-zhou', displayName: '周岚', username: 'zhoulan' },
				body: {
					rawMarkdown: '目前先盯 `subscriptions.get`、`rooms.get`、`chat.syncMessages` 三条主链。',
				},
				flags: { edited: false, deleted: false },
			}),
			message({
				id: 'platform-002',
				roomId: 'platform-duty',
				createdAt: '2026-03-25T09:07:00.000Z',
				author: { id: 'user-chen', displayName: 'Alexander Chen', username: 'achen' },
				body: {
					rawMarkdown: '如果前端只依赖 BetterChat 合同层，后面换掉上游细节时 UI 不会一起抖。',
				},
				flags: { edited: false, deleted: false },
			}),
			message({
				id: 'platform-003',
				roomId: 'platform-duty',
				createdAt: '2026-03-25T09:22:00.000Z',
				author: { id: 'user-mia', displayName: 'Mia 张', username: 'mia' },
				body: {
					rawMarkdown: `接口回放里先记这条：

> **转发自 顾宁 · 运营协调 · 17:09**
>
> 再补一张图，确认 markdown 图片与附件图片都能用同一套界面语言承接：
>
> ![兼容流程示意图](/api/media/fixtures/compat-flow.svg)
>
> ![交接结构图](/api/media/fixtures/ops-handoff-board.svg)`,
				},
				flags: { edited: false, deleted: false },
			}),
		],
		unreadFromMessageId: 'platform-002',
	},
	'compat-lab': {
		room: {
			id: 'compat-lab',
			title: 'Rocket.Chat 兼容',
			kind: 'channel',
		},
		messages: [
			message({
				id: 'compat-001',
				roomId: 'compat-lab',
				createdAt: '2026-03-25T08:26:00.000Z',
				author: { id: 'user-ouyang', displayName: '欧阳明远', username: 'mingyuan' },
				body: {
					rawMarkdown: '兼容结论先按快照优先，实时更新留到下一刀。',
				},
				flags: { edited: false, deleted: false },
			}),
			message({
				id: 'compat-002',
				roomId: 'compat-lab',
				createdAt: '2026-03-25T08:33:00.000Z',
				author: { id: 'user-ouyang', displayName: '欧阳明远', username: 'mingyuan' },
				body: {
					rawMarkdown: '请 @zhoulan 再补一轮 mention 兼容验证。',
				},
				flags: { edited: false, deleted: false },
			}),
		],
	},
	'readonly-updates': {
		room: {
			id: 'readonly-updates',
			title: '只读公告',
			kind: 'channel',
		},
		messages: [
			message({
				id: 'readonly-001',
				roomId: 'readonly-updates',
				createdAt: '2026-03-25T08:46:00.000Z',
				author: { id: 'user-ouyang', displayName: '欧阳明远', username: 'mingyuan' },
				body: {
					rawMarkdown: '这里只发布统一说明与制度更新，BetterChat 在这里只应显示只读提示，不应保留发送框。',
				},
				flags: { edited: false, deleted: false },
			}),
		],
	},
	'delivery-room': {
		room: {
			id: 'delivery-room',
			title: '客户交付',
			kind: 'channel',
		},
		messages: [
			message({
				id: 'delivery-001',
				roomId: 'delivery-room',
				createdAt: '2026-03-25T09:01:00.000Z',
				author: { id: 'user-ouyang', displayName: '欧阳明远', username: 'mingyuan' },
				body: {
					rawMarkdown: '交付频道的重点是 **先给结论，再放补充说明**。',
				},
				flags: { edited: false, deleted: false },
			}),
				message({
					id: 'delivery-002',
					roomId: 'delivery-room',
					createdAt: '2026-03-25T09:20:00.000Z',
					author: { id: 'user-linche', displayName: '林澈', username: 'linche' },
					body: {
						rawMarkdown: '客户侧主要关心“现在能不能用”，不关心内部实现细节，所以主消息流要先可扫读。',
					},
					flags: { edited: false, deleted: false },
				}),
				message({
					id: 'delivery-003',
					roomId: 'delivery-room',
					createdAt: '2026-03-25T09:28:00.000Z',
					author: { id: 'user-ouyang', displayName: '欧阳明远', username: 'mingyuan' },
					body: {
						rawMarkdown:
							'对外交付时，先看 [交付手册](https://betterchat.example/runbook)，再决定要不要把更细的实现说明贴进主时间线。',
					},
					flags: { edited: false, deleted: false },
				}),
			],
			unreadFromMessageId: 'delivery-001',
		},
	'dm-mia': {
		room: {
			id: 'dm-mia',
			title: 'Mia 张',
			kind: 'dm',
		},
		messages: [
			message({
				id: 'mia-001',
				roomId: 'dm-mia',
				createdAt: '2026-03-25T09:18:00.000Z',
				author: { id: 'user-mia', displayName: 'Mia 张', username: 'mia' },
				body: {
					rawMarkdown: '右侧信息栏我会继续收紧，只保留对当前房间真正有帮助的内容。',
				},
				flags: { edited: false, deleted: false },
			}),
		],
		unreadFromMessageId: 'mia-001',
	},
	'dm-zhoulan': {
		room: {
			id: 'dm-zhoulan',
			title: '周岚',
			kind: 'dm',
		},
		messages: [
			message({
				id: 'zhou-001',
				roomId: 'dm-zhoulan',
				createdAt: '2026-03-25T08:42:00.000Z',
				author: { id: 'user-zhou', displayName: '周岚', username: 'zhoulan' },
				body: {
					rawMarkdown: '等 backend 会话层好了以后，再把真实接口接进来。',
				},
				flags: { edited: false, deleted: false },
			}),
		],
	},
	'history-archive': {
		room: {
			id: 'history-archive',
			title: '历史归档',
			kind: 'channel',
		},
		messages: historyArchiveMessages,
	},
	'dm-guning': {
		room: {
			id: 'dm-guning',
			title: '顾宁',
			kind: 'dm',
		},
		messages: [
			message({
				id: 'guning-001',
				roomId: 'dm-guning',
				createdAt: '2026-03-25T09:12:00.000Z',
				author: { id: 'user-gu', displayName: '顾宁', username: 'guning' },
				body: {
					rawMarkdown: '我先在交付侧补完图文说明，晚一点再回你这边的图片细节。',
				},
				flags: { edited: false, deleted: false },
			}),
			message({
				id: 'guning-002',
				roomId: 'dm-guning',
				createdAt: '2026-03-25T09:24:00.000Z',
				author: { id: 'user-gu', displayName: '顾宁', username: 'guning' },
				body: {
					rawMarkdown: '如果今天节奏继续顶满，我这边可能会先挂忙碌状态。',
				},
				flags: { edited: false, deleted: false },
			}),
		],
		unreadFromMessageId: 'guning-001',
	},
	'dm-achen': {
		room: {
			id: 'dm-achen',
			title: 'Alexander Chen',
			kind: 'dm',
		},
		messages: [
			message({
				id: 'achen-001',
				roomId: 'dm-achen',
				createdAt: '2026-03-25T07:58:00.000Z',
				author: { id: 'user-chen', displayName: 'Alexander Chen', username: 'achen' },
				body: {
					rawMarkdown: '我先下线一阵，接口兼容清单已经同步到频道里了。',
				},
				flags: { edited: false, deleted: false },
			}),
		],
	},
};

const cloneValue = <T,>(value: T): T => {
	if (typeof structuredClone === 'function') {
		return structuredClone(value);
	}

	return JSON.parse(JSON.stringify(value)) as T;
};

const initialSidebarResponse = cloneValue(sidebarResponse);
const initialRoomDetailsMap = cloneValue(roomDetailsMap);
const initialTimelineMap = cloneValue(timelineMap);
const initialParticipantUserIdsByRoomId = cloneValue(fixtureParticipantUserIdsByRoomId);

type FixtureConversationRecord = {
	capabilities: ConversationCapabilities;
	conversation: ConversationSnapshot['conversation'];
	live?: ConversationLiveState;
	membership: ConversationSnapshot['membership'];
	timeline: ConversationMessage[];
	unreadAnchorMessageId?: string;
};

type FixtureState = {
	conversationOrder: string[];
	conversations: Record<string, FixtureConversationRecord>;
	directConversationRoomIdByUserId: Record<string, string>;
	participantUserIdsByConversationId: Record<string, string[]>;
};

const computeFixtureVersion = (value: unknown) => {
	const source = JSON.stringify(value);
	let hash = 2166136261;

	for (let index = 0; index < source.length; index += 1) {
		hash ^= source.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}

	return `fixture-${(hash >>> 0).toString(16)}`;
};

const withVersion = <T extends object>(value: T): T & { version: string } => ({
	...value,
	version: computeFixtureVersion(value),
});

const createMessageId = (roomId: string) => `${roomId}-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createNextFixtureMessageTimestamp = (messages: ConversationMessage[]) => {
	const now = Date.now();
	const latestMessageTimestamp = messages.reduce((latestTimestamp, message) => {
		const messageTimestamp = Date.parse(message.authoredAt);
		return Number.isFinite(messageTimestamp) ? Math.max(latestTimestamp, messageTimestamp) : latestTimestamp;
	}, Number.NEGATIVE_INFINITY);
	const baseTimestamp = Number.isFinite(latestMessageTimestamp) ? latestMessageTimestamp + 1_000 : now;

	return new Date(Math.max(now, baseTimestamp)).toISOString();
};

const createFixtureAuthor = (user: SessionUser): ConversationMessage['author'] => ({
	id: user.id,
	displayName: user.displayName,
	username: user.username,
	avatarUrl: user.avatarUrl,
});

const zeroInboxState = () => ({
	unreadMessages: 0,
	mentionCount: 0,
	replyCount: 0,
	hasThreadActivity: false,
	hasUncountedActivity: false,
});

const fixtureCapabilities: ConversationCapabilities = {
	star: true,
	hide: true,
	markRead: true,
	markUnread: true,
	react: false,
	messageMutations: {
		conversation: true,
		conversationReply: true,
		thread: false,
		threadEchoToConversation: true,
	},
	mediaMutations: {
		conversation: true,
		conversationReply: false,
		thread: false,
		threadEchoToConversation: false,
	},
};

const createFixtureConversationCapabilities = ({ readOnly = false }: { readOnly?: boolean } = {}): ConversationCapabilities =>
	readOnly
		? {
				...fixtureCapabilities,
				messageMutations: {
					conversation: false,
					conversationReply: false,
					thread: false,
					threadEchoToConversation: false,
				},
				mediaMutations: {
					conversation: false,
					conversationReply: false,
					thread: false,
					threadEchoToConversation: false,
				},
		  }
		: {
				...fixtureCapabilities,
				messageMutations: { ...fixtureCapabilities.messageMutations },
				mediaMutations: { ...fixtureCapabilities.mediaMutations },
		  };

const fixtureAvatarUrlFromUsername = (username: string) => `/api/media/avatar/${encodeURIComponent(username)}`;

const fixtureKnownUserById = new Map<string, FixtureKnownUser>(
	fixtureKnownUsers.flatMap((user) => [user.id, ...(user.aliases ?? [])].map((userId) => [userId, user] as const)),
);

const fixturePresenceFromStatus = (status: string | undefined): PresenceState | undefined =>
	status === 'online' || status === 'away' || status === 'busy' || status === 'offline' ? status : undefined;

const toFixtureSessionUserSummary = (user: SessionUser): UserSummary => ({
	id: user.id,
	username: user.username,
	displayName: user.displayName,
	...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
	...(fixturePresenceFromStatus(user.status) ? { presence: fixturePresenceFromStatus(user.status) } : {}),
});

const fixtureDirectConversationRoomIdByUserId = new Map<string, string>(
	fixtureKnownUsers.flatMap((user) => {
		const { existingConversationId } = user;
		if (!existingConversationId) {
			return [];
		}

		return [user.id, ...(user.aliases ?? [])].map((userId) => [userId, existingConversationId] as const);
	}),
);

const fixtureStorageFallback = new Map<string, string>();
const fixtureCreatedObjectUrls = new Set<string>();

const getFixtureStorage = () => {
	if (typeof window !== 'undefined' && window.localStorage) {
		return window.localStorage;
	}

	return {
		getItem: (key: string) => fixtureStorageFallback.get(key) ?? null,
		setItem: (key: string, value: string) => {
			fixtureStorageFallback.set(key, value);
		},
		removeItem: (key: string) => {
			fixtureStorageFallback.delete(key);
		},
	};
};

const createFixtureObjectUrl = (file: File) => {
	if (typeof URL.createObjectURL === 'function') {
		const objectUrl = URL.createObjectURL(new Blob([file], { type: file.type }));
		fixtureCreatedObjectUrls.add(objectUrl);
		return objectUrl;
	}

	return `fixture://image/${encodeURIComponent(file.name || createMessageId('image'))}`;
};

const revokeFixtureObjectUrls = () => {
	if (typeof URL.revokeObjectURL === 'function') {
		for (const objectUrl of fixtureCreatedObjectUrls) {
			URL.revokeObjectURL(objectUrl);
		}
	}

	fixtureCreatedObjectUrls.clear();
};

const stripFixturePresenceSuffix = (subtitle: string | undefined) => {
	if (!subtitle) {
		return undefined;
	}

	const match = subtitle.match(/^(.*?)(?:\s*[·•・]\s*)?(在线|离开|忙碌|离线)$/u);
	const text = (match?.[1] ?? subtitle).trim();
	return text || undefined;
};

const toConversationKind = (kind: FixtureSidebarEntry['kind']): ConversationKind => {
	if (kind === 'dm') {
		return {
			mode: 'direct',
		};
	}

	return {
		mode: 'group',
		privacy: kind === 'channel' ? 'public' : 'private',
	};
};

const toCanonicalMessage = (message: TimelineMessage): ConversationMessage => ({
	id: message.id,
	...(message.submissionId ? { submissionId: message.submissionId } : {}),
	conversationId: message.roomId,
	authoredAt: message.createdAt,
	updatedAt: message.updatedAt,
	author: {
		id: message.author.id,
		displayName: message.author.displayName,
		avatarUrl: message.author.avatarUrl,
		...(message.author.username ? { username: message.author.username } : {}),
	},
	content: {
		format: 'markdown',
		text: message.body.rawMarkdown,
	},
	state: {
		edited: message.flags.edited,
		deleted: message.flags.deleted,
	},
	...(message.replyTo ? { replyTo: { ...message.replyTo } } : {}),
	...(message.thread
		? {
				thread: {
					rootMessageId: message.thread.rootMessageId ?? message.id,
					replyCount: message.thread.replyCount,
					...(message.thread.lastReplyAt ? { lastReplyAt: message.thread.lastReplyAt } : {}),
				},
		  }
		: {}),
	...(message.attachments ? { attachments: message.attachments.map((attachment) => ({ ...attachment })) } : {}),
	...(message.reactions ? { reactions: message.reactions.map((reaction) => ({ ...reaction })) } : {}),
});

const toReplyReference = (message: ConversationMessage): ConversationMessageReference => createReplyPreviewFromMessage(toTimelineMessage(message));

const stampMessageActions = (message: ConversationMessage, currentUserId: string | undefined): ConversationMessage => {
	if (!currentUserId || message.state.deleted) {
		return { ...message, actions: { edit: false, delete: false } };
	}

	const isOwnMessage = message.author.id === currentUserId;
	return {
		...message,
		actions: {
			edit: isOwnMessage,
			delete: isOwnMessage,
		},
	};
};

const buildFixtureState = (): FixtureState => {
	const conversationOrder = initialSidebarResponse.entries.map((entry) => entry.roomId);
	const conversations = Object.fromEntries(
		initialSidebarResponse.entries.map((entry) => {
			const roomDetails = initialRoomDetailsMap[entry.roomId];
			const roomTimeline = initialTimelineMap[entry.roomId];
			if (!roomDetails || !roomTimeline) {
				throw new Error(`Fixture seed is incomplete for conversation ${entry.roomId}.`);
			}

			const presence = entry.kind === 'dm' ? fixturePresenceFromSubtitle(entry.subtitle) : undefined;
			const handle = entry.kind === 'dm' ? stripFixturePresenceSuffix(entry.subtitle) : entry.subtitle?.trim() || undefined;
			const record: FixtureConversationRecord = {
				capabilities: createFixtureConversationCapabilities({
					readOnly: roomDetails.readOnly,
				}),
				conversation: {
					id: entry.roomId,
					kind: toConversationKind(entry.kind),
					title: roomDetails.title,
					avatarUrl: entry.avatarUrl,
					lastActivityAt: entry.lastActivityAt,
					topic: roomDetails.topic,
					description: roomDetails.description,
					memberCount: roomDetails.memberCount,
					announcement: roomDetails.announcement,
					...(handle ? { handle } : {}),
				},
				membership: {
					listing: entry.open ? 'listed' : 'hidden',
					starred: entry.favorite,
					inbox: {
						unreadMessages: entry.unreadCount,
						mentionCount: entry.mentioned ? 1 : 0,
						replyCount: 0,
						hasThreadActivity: false,
						hasUncountedActivity: false,
					},
				},
				...(presence ? { live: { counterpartPresence: presence } } : {}),
				timeline: roomTimeline.messages.map(toCanonicalMessage),
				unreadAnchorMessageId: roomTimeline.unreadFromMessageId,
			};

			return [entry.roomId, record];
		}),
	) as Record<string, FixtureConversationRecord>;

	return {
		conversationOrder,
		conversations,
		directConversationRoomIdByUserId: Array.from(fixtureDirectConversationRoomIdByUserId.entries()).reduce<
			Record<string, string>
		>((accumulator, [userId, roomId]) => {
				accumulator[userId] = roomId;
				return accumulator;
			}, {}),
		participantUserIdsByConversationId: cloneValue(initialParticipantUserIdsByRoomId),
	};
};

let fixtureState = buildFixtureState();

const resetFixtureState = () => {
	revokeFixtureObjectUrls();
	fixtureState = buildFixtureState();
};

const buildDirectoryEntry = (roomId: string): DirectoryEntry => {
	const record = fixtureState.conversations[roomId];
	if (!record) {
		throw new Error(`Fixture conversation ${roomId} is missing.`);
	}

	return {
		conversation: {
			id: record.conversation.id,
			kind: cloneValue(record.conversation.kind),
			title: record.conversation.title,
			...(record.conversation.handle ? { handle: record.conversation.handle } : {}),
			...(record.conversation.avatarUrl ? { avatarUrl: record.conversation.avatarUrl } : {}),
			...(record.conversation.lastActivityAt ? { lastActivityAt: record.conversation.lastActivityAt } : {}),
		},
		membership: cloneValue(record.membership),
		...(record.live ? { live: cloneValue(record.live) } : {}),
	};
};

const buildDirectorySnapshot = (): DirectorySnapshot =>
	withVersion({
		entries: fixtureState.conversationOrder.map((roomId) => buildDirectoryEntry(roomId)),
	});

const buildConversationSnapshot = (roomId: string): ConversationSnapshot => {
	const record = fixtureState.conversations[roomId];
	if (!record) {
		throw {
			code: 'NOT_FOUND' as const,
			message: '未找到目标房间。',
		};
	}

	return withVersion({
		conversation: cloneValue(record.conversation),
		membership: cloneValue(record.membership),
		...(record.live ? { live: cloneValue(record.live) } : {}),
		capabilities: cloneValue(record.capabilities),
	});
};

const encodeFixtureTimelineCursor = (offset: number) => globalThis.btoa(JSON.stringify({ offset }));

const decodeFixtureTimelineCursor = (cursor: string): number => {
	try {
		const payload = JSON.parse(globalThis.atob(cursor)) as {
			offset?: unknown;
		};
		const offset = payload?.offset;
		if (!payload || typeof payload !== 'object' || typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
			throw new Error('invalid cursor payload');
		}

		return offset;
	} catch {
		throw {
			code: 'VALIDATION_ERROR' as const,
			message: '"cursor" must be a valid BetterChat pagination cursor',
		};
	}
};

const resolveFixtureTimelineLimit = (limit: number | undefined) => {
	if (limit === undefined) {
		return FIXTURE_TIMELINE_PAGE_SIZE;
	}

	if (!Number.isSafeInteger(limit) || limit <= 0) {
		throw {
			code: 'VALIDATION_ERROR' as const,
			message: '"limit" must be a positive integer when provided',
		};
	}

	return limit;
};

const buildConversationTimelineSnapshot = (
	roomId: string,
	options: FixtureTimelineRequestOptions = {},
): ConversationTimelineSnapshot => {
	const record = fixtureState.conversations[roomId];
	if (!record) {
		throw {
			code: 'NOT_FOUND' as const,
			message: '未找到目标消息流。',
		};
	}

	const limit = resolveFixtureTimelineLimit(options.limit);
	const totalMessages = record.timeline.length;
	const unreadAnchorIndex = record.unreadAnchorMessageId
		? record.timeline.findIndex((message) => message.id === record.unreadAnchorMessageId)
		: -1;
	const pageMessages = (() => {
		if (options.cursor) {
			const offset = decodeFixtureTimelineCursor(options.cursor);
			const descendingMessages = [...record.timeline].reverse();
			return descendingMessages.slice(offset, offset + limit).reverse();
		}

		const latestStartIndex = Math.max(totalMessages - limit, 0);
		const startIndex = unreadAnchorIndex >= 0 ? Math.min(unreadAnchorIndex, latestStartIndex) : latestStartIndex;
		return record.timeline.slice(startIndex);
	})();
	const nextCursor = (() => {
		if (pageMessages.length === 0) {
			return undefined;
		}

		if (options.cursor) {
			const offset = decodeFixtureTimelineCursor(options.cursor);
			const nextOffset = offset + pageMessages.length;
			return nextOffset < totalMessages ? encodeFixtureTimelineCursor(nextOffset) : undefined;
		}

		const consumedNewestCount = pageMessages.length;
		return consumedNewestCount < totalMessages ? encodeFixtureTimelineCursor(consumedNewestCount) : undefined;
	})();
	const unreadAnchorMessageId =
		record.unreadAnchorMessageId && pageMessages.some((message) => message.id === record.unreadAnchorMessageId)
			? record.unreadAnchorMessageId
			: undefined;

	return withVersion({
		scope: {
			kind: 'conversation' as const,
			conversationId: roomId,
		},
		messages: cloneValue(pageMessages).map((m: ConversationMessage) => stampMessageActions(m, readStoredSessionUser()?.id)),
		...(nextCursor ? { nextCursor } : {}),
		...(unreadAnchorMessageId ? { unreadAnchorMessageId } : {}),
	});
};

const buildMembershipSyncState = (roomId: string, options: { includeTimeline?: boolean } = {}) => ({
	directoryVersion: buildDirectorySnapshot().version,
	conversationVersion: buildConversationSnapshot(roomId).version,
	...(options.includeTimeline ? { timelineVersion: buildConversationTimelineSnapshot(roomId).version } : {}),
});

const readStoredSessionUser = () => {
	const storage = getFixtureStorage();
	const raw = storage.getItem(FIXTURE_SESSION_STORAGE_KEY);
	if (!raw) {
		return null;
	}

	try {
		return JSON.parse(raw) as SessionUser;
	} catch {
		storage.removeItem(FIXTURE_SESSION_STORAGE_KEY);
		return null;
	}
};

const writeStoredSessionUser = (user: SessionUser | null) => {
	const storage = getFixtureStorage();

	if (!user) {
		storage.removeItem(FIXTURE_SESSION_STORAGE_KEY);
		return;
	}

	storage.setItem(FIXTURE_SESSION_STORAGE_KEY, JSON.stringify(user));
};

const consumeFixtureFlag = (storageKey: string) => {
	const storage = getFixtureStorage();
	const value = storage.getItem(storageKey);
	if (!value) {
		return false;
	}

	storage.removeItem(storageKey);
	return value === '1' || value.toLowerCase() === 'true';
};

const hasFixtureFlag = (storageKey: string) => {
	const value = getFixtureStorage().getItem(storageKey);
	return Boolean(value && (value === '1' || value.toLowerCase() === 'true'));
};

const requireFixtureKnownUser = (userId: string): FixtureKnownUser => {
	const user = fixtureKnownUserById.get(userId);
	if (!user) {
		throw {
			code: 'NOT_FOUND' as const,
			message: '未找到目标用户。',
		};
	}

	return user;
};

const toFixtureUserSummary = (user: FixtureKnownUser): UserSummary => ({
	id: user.id,
	username: user.username,
	displayName: user.displayName,
	avatarUrl: fixtureAvatarUrlFromUsername(user.username),
	presence: user.presence,
});

const createFixtureDirectConversationRecord = ({
	roomId,
	user,
}: {
	roomId: string;
	user: FixtureKnownUser;
}): FixtureConversationRecord => ({
	capabilities: cloneValue(fixtureCapabilities),
	conversation: {
		id: roomId,
		kind: {
			mode: 'direct',
		},
		title: user.displayName,
		handle: user.username,
		avatarUrl: fixtureAvatarUrlFromUsername(user.username),
		lastActivityAt: new Date().toISOString(),
		description: `${user.displayName} 的直接会话。`,
		memberCount: 2,
	},
	live: {
		counterpartPresence: user.presence,
	},
	membership: {
		listing: 'listed',
		starred: false,
		inbox: zeroInboxState(),
	},
	timeline: [],
});

const requireFixtureSessionUser = () => {
	const user = readStoredSessionUser();
	if (!user) {
		throw {
			code: 'UNAUTHENTICATED' as const,
			message: '当前未登录。',
		};
	}

	return user;
};

const normalizeFixtureUser = (request: LoginRequest): SessionUser => {
	const normalizedLogin = request.login.trim();
	if (!normalizedLogin) {
		return demoUser;
	}

	const username = normalizedLogin.includes('@') ? normalizedLogin.slice(0, normalizedLogin.indexOf('@')) : normalizedLogin;
	return {
		...demoUser,
		username: username || demoUser.username,
		displayName: username || demoUser.displayName,
	};
};

const requireFixtureConversationRecord = (conversationId: string) => {
	const record = fixtureState.conversations[conversationId];
	if (!record) {
		throw {
			code: 'NOT_FOUND' as const,
			message: '未找到目标房间。',
		};
	}

	return record;
};

type FixtureParticipantsRequestOptions = {
	cursor?: string;
	limit?: number;
	query?: string;
};

type FixtureMentionCandidatesRequestOptions = {
	limit?: number;
	query?: string;
};

const resolveFixtureParticipantsLimit = (limit: number | undefined) => {
	if (limit === undefined) {
		return 50;
	}

	if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
		throw {
			code: 'VALIDATION_ERROR' as const,
			message: '"limit" must be a positive integer no greater than 100',
		};
	}

	return limit;
};

const resolveFixtureMentionCandidatesLimit = (limit: number | undefined) => {
	if (limit === undefined) {
		return 8;
	}

	if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 20) {
		throw {
			code: 'VALIDATION_ERROR' as const,
			message: '"limit" must be a positive integer no greater than 20',
		};
	}

	return limit;
};

const normalizeFixtureParticipantSearchQuery = (query: string | undefined) => {
	const normalized = query?.trim();
	return normalized && normalized.length > 0 ? normalized : undefined;
};

const normalizeFixtureMentionSearchValue = (value: string) =>
	value.trim().replace(/^@+/, '').replace(/[\s._-]+/g, '').toLowerCase();

const memberSearchQueryFromFixtureMentionInput = (value: string): string | undefined => {
	const normalized = value.trim().replace(/^@+/, '');
	return normalized.length > 0 ? normalized : undefined;
};

const matchesFixtureParticipantQuery = (participant: ConversationParticipant, query: string | undefined) => {
	if (!query) {
		return true;
	}

	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) {
		return true;
	}

	return (
		participant.user.displayName.toLowerCase().includes(normalizedQuery) ||
		(participant.user.username?.toLowerCase().includes(normalizedQuery) ?? false)
	);
};

const scoreFixtureMentionCandidate = (participant: ConversationParticipant, normalizedQuery: string) => {
	if (!normalizedQuery) {
		return 0;
	}

	const normalizedUsername = normalizeFixtureMentionSearchValue(participant.user.username ?? '');
	const normalizedDisplayName = normalizeFixtureMentionSearchValue(participant.user.displayName);
	let bestScore = Number.NEGATIVE_INFINITY;

	if (normalizedUsername) {
		if (normalizedUsername === normalizedQuery) {
			bestScore = Math.max(bestScore, 520);
		} else if (normalizedUsername.startsWith(normalizedQuery)) {
			bestScore = Math.max(bestScore, 460 - Math.max(normalizedUsername.length - normalizedQuery.length, 0));
		} else if (normalizedUsername.includes(normalizedQuery)) {
			bestScore = Math.max(bestScore, 300 - normalizedUsername.indexOf(normalizedQuery));
		}
	}

	if (normalizedDisplayName) {
		if (normalizedDisplayName === normalizedQuery) {
			bestScore = Math.max(bestScore, 420);
		} else if (normalizedDisplayName.startsWith(normalizedQuery)) {
			bestScore = Math.max(bestScore, 360 - Math.max(normalizedDisplayName.length - normalizedQuery.length, 0));
		} else if (normalizedDisplayName.includes(normalizedQuery)) {
			bestScore = Math.max(bestScore, 240 - normalizedDisplayName.indexOf(normalizedQuery));
		}
	}

	return bestScore;
};

const resolveFixtureConversationParticipant = ({
	currentUser,
	userId,
}: {
	currentUser: SessionUser;
	userId: string;
}): ConversationParticipant => {
	if (userId === currentUser.id) {
		return {
			self: true,
			user: toFixtureSessionUserSummary(currentUser),
		};
	}

	return {
		self: false,
		user: toFixtureUserSummary(requireFixtureKnownUser(userId)),
	};
};

const resolveFixtureConversationParticipants = ({
	conversationId,
	currentUser,
}: {
	conversationId: string;
	currentUser: SessionUser;
}) => {
	const record = requireFixtureConversationRecord(conversationId);
	const participantUserIds = fixtureState.participantUserIdsByConversationId[conversationId];
	if (!participantUserIds) {
		throw new Error(`Fixture conversation ${conversationId} is missing participant data.`);
	}

	return {
		kind: record.conversation.kind,
		participants: participantUserIds.map((userId) => resolveFixtureConversationParticipant({ currentUser, userId })),
	};
};

const buildFixtureConversationParticipantsPage = ({
	conversationId,
	currentUser,
	options = {},
}: {
	conversationId: string;
	currentUser: SessionUser;
	options?: FixtureParticipantsRequestOptions;
}): ConversationParticipantsPage => {
	const { participants } = resolveFixtureConversationParticipants({
		conversationId,
		currentUser,
	});
	const filteredParticipants = participants.filter((participant) =>
		matchesFixtureParticipantQuery(participant, normalizeFixtureParticipantSearchQuery(options.query)),
	);
	const limit = resolveFixtureParticipantsLimit(options.limit);
	const offset = options.cursor ? decodeFixtureTimelineCursor(options.cursor) : 0;
	const entries = filteredParticipants.slice(offset, offset + limit);
	const nextCursor = offset + entries.length < filteredParticipants.length ? encodeFixtureTimelineCursor(offset + entries.length) : undefined;

	return withVersion({
		conversationId,
		entries,
		...(nextCursor ? { nextCursor } : {}),
	});
};

const buildFixtureConversationMentionCandidates = ({
	conversationId,
	currentUser,
	options = {},
}: {
	conversationId: string;
	currentUser: SessionUser;
	options?: FixtureMentionCandidatesRequestOptions;
}): ConversationMentionCandidatesResponse => {
	const { kind } = resolveFixtureConversationParticipants({
		conversationId,
		currentUser,
	});
	const normalizedQuery = normalizeFixtureMentionSearchValue(options.query ?? '');
	const memberSearchQuery = memberSearchQueryFromFixtureMentionInput(options.query ?? '');
	const limit = resolveFixtureMentionCandidatesLimit(options.limit);
	const specialCandidates: ConversationMentionCandidate[] =
		kind.mode === 'direct'
			? []
			: [
					{
						kind: 'special' as const,
						key: 'all' as const,
						label: 'Notify everyone in this conversation',
						insertText: '@all',
					},
					{
						kind: 'special' as const,
						key: 'here' as const,
						label: 'Notify active members in this conversation',
						insertText: '@here',
					},
			  ].filter((candidate) => !normalizedQuery || candidate.key.startsWith(normalizedQuery));
	if (limit <= specialCandidates.length) {
		return withVersion({
			conversationId,
			query: normalizedQuery,
			entries: specialCandidates.slice(0, limit),
		});
	}

	const participantsPage = buildFixtureConversationParticipantsPage({
		conversationId,
		currentUser,
		options: {
			limit: normalizedQuery ? Math.min(Math.max((limit - specialCandidates.length) * 4, 25), 100) : limit - specialCandidates.length,
			query: memberSearchQuery,
		},
	});
	const userCandidates = participantsPage.entries
		.filter((participant) => !participant.self)
		.map((participant, index) => ({
			candidate: participant.user.username?.trim() || participant.user.displayName.trim()
				? {
						kind: 'user' as const,
						user: participant.user,
						insertText: `@${participant.user.username?.trim() || participant.user.displayName.trim()}`,
				  }
				: null,
			index,
			score: scoreFixtureMentionCandidate(participant, normalizedQuery),
		}))
		.filter(
			(entry): entry is {
				candidate: NonNullable<typeof entry.candidate>;
				index: number;
				score: number;
			} => entry.candidate !== null && (normalizedQuery.length === 0 || Number.isFinite(entry.score)),
		)
		.sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}

			return left.index - right.index;
		})
		.slice(0, Math.max(limit - specialCandidates.length, 0))
		.map((entry) => entry.candidate);

	return withVersion({
		conversationId,
		query: normalizedQuery,
		entries: [...userCandidates, ...specialCandidates],
	});
};

export const fixtureBetterChatService = {
	mode: 'fixture' as const,
	publicBootstrap: async () =>
		cloneValue({
			...publicBootstrap,
			session: {
				authenticated: readStoredSessionUser() !== null,
			},
		}),
	login: async (request: LoginRequest): Promise<LoginResponse> => {
		if (!request.login.trim() || !request.password.trim()) {
			throw {
				code: 'VALIDATION_ERROR' as const,
				message: '请输入账号和密码。',
			};
		}

		resetFixtureState();
		const user = normalizeFixtureUser(request);
		writeStoredSessionUser(user);
		return cloneValue({ user });
	},
	logout: async () => {
		writeStoredSessionUser(null);
	},
	workspace: async () => cloneValue(workspaceBootstrap(requireFixtureSessionUser())),
	directory: async (): Promise<DirectorySnapshot> => {
		requireFixtureSessionUser();
		return cloneValue(buildDirectorySnapshot());
	},
	conversation: async (conversationId: string): Promise<ConversationSnapshot> => {
		requireFixtureSessionUser();
		return cloneValue(buildConversationSnapshot(conversationId));
	},
	conversationParticipants: async (
		conversationId: string,
		options: FixtureParticipantsRequestOptions = {},
	): Promise<ConversationParticipantsPage> => {
		const currentUser = requireFixtureSessionUser();
		return cloneValue(
			buildFixtureConversationParticipantsPage({
				conversationId,
				currentUser,
				options,
			}),
		);
	},
	conversationMentionCandidates: async (
		conversationId: string,
		options: FixtureMentionCandidatesRequestOptions = {},
	): Promise<ConversationMentionCandidatesResponse> => {
		const currentUser = requireFixtureSessionUser();
		return cloneValue(
			buildFixtureConversationMentionCandidates({
				conversationId,
				currentUser,
				options,
			}),
		);
	},
	conversationTimeline: async (
		conversationId: string,
		options: FixtureTimelineRequestOptions = {},
	): Promise<ConversationTimelineSnapshot> => {
		requireFixtureSessionUser();
		return cloneValue(buildConversationTimelineSnapshot(conversationId, options));
	},
	conversationMessageContext: async (
		conversationId: string,
		messageId: string,
		options: { after?: number; before?: number } = {},
	): Promise<ConversationMessageContextSnapshot> => {
		requireFixtureSessionUser();
		const record = requireFixtureConversationRecord(conversationId);
		const anchorIndex = record.timeline.findIndex((message) => message.id === messageId);
		if (anchorIndex < 0) {
			throw {
				code: 'NOT_FOUND' as const,
				message: '未找到目标消息。',
			};
		}

		const before = Math.max(options.before ?? 12, 0);
		const after = Math.max(options.after ?? 12, 0);
		const startIndex = Math.max(anchorIndex - before, 0);
		const endIndex = Math.min(anchorIndex + after + 1, record.timeline.length);

		return cloneValue(
			withVersion({
				conversationId,
				anchorMessageId: messageId,
				anchorIndex: anchorIndex - startIndex,
				messages: record.timeline.slice(startIndex, endIndex).map((m) => stampMessageActions(m, readStoredSessionUser()?.id)),
				hasBefore: startIndex > 0,
				hasAfter: endIndex < record.timeline.length,
			}),
		);
	},
	createConversationMessage: async (
		conversationId: string,
		request: CreateConversationMessageRequest,
	): Promise<CreateConversationMessageResponse> => {
		const currentUser = requireFixtureSessionUser();
		const record = requireFixtureConversationRecord(conversationId);
		const trimmedText = request.content.text.trim();

		if (!trimmedText) {
			throw {
				code: 'VALIDATION_ERROR' as const,
				message: '消息内容不能为空。',
			};
		}

		const target = request.target;
		if (target.kind === 'thread') {
			throw {
				code: 'UNSUPPORTED_UPSTREAM_BEHAVIOR' as const,
				message: '当前 fixture 暂不支持仅线程消息发送。',
			};
		}

		const replyToMessage = target.replyToMessageId
			? record.timeline.find((message) => message.id === target.replyToMessageId)
			: undefined;
		if (target.replyToMessageId && !replyToMessage) {
			throw {
				code: 'NOT_FOUND' as const,
				message: '未找到被回复的消息。',
			};
		}

		const createdAt = createNextFixtureMessageTimestamp(record.timeline);
		const message: ConversationMessage = {
			id: request.submissionId ?? createMessageId(conversationId),
			...(request.submissionId ? { submissionId: request.submissionId } : {}),
			conversationId,
			authoredAt: createdAt,
			author: createFixtureAuthor(currentUser),
			content: {
				format: 'markdown',
				text: trimmedText,
			},
			state: {
				edited: false,
				deleted: false,
			},
			...(replyToMessage ? { replyTo: toReplyReference(replyToMessage) } : {}),
		};

		record.timeline.push(message);
		record.membership.inbox = zeroInboxState();
		record.unreadAnchorMessageId = undefined;
		record.conversation.lastActivityAt = createdAt;

		return cloneValue({
			message: stampMessageActions(message, currentUser.id),
			sync: buildMembershipSyncState(conversationId, {
				includeTimeline: true,
			}),
		});
	},
	uploadConversationMedia: async (
		conversationId: string,
		request: { file: File; text?: string },
	): Promise<CreateConversationMessageResponse> => {
		const currentUser = requireFixtureSessionUser();
		const record = requireFixtureConversationRecord(conversationId);
		const trimmedText = request.text?.trim();

		if (!(request.file instanceof File) || request.file.size <= 0) {
			throw {
				code: 'VALIDATION_ERROR' as const,
				message: '请选择一张图片后再发送。',
			};
		}

		if (!request.file.type.startsWith('image/')) {
			throw {
				code: 'VALIDATION_ERROR' as const,
				message: '当前只支持图片上传。',
			};
		}

		if (hasFixtureFlag(FIXTURE_FAIL_IMAGE_UPLOAD_ALWAYS_STORAGE_KEY) || consumeFixtureFlag(FIXTURE_FAIL_NEXT_IMAGE_UPLOAD_STORAGE_KEY)) {
			throw {
				code: 'UPSTREAM_UNAVAILABLE' as const,
				message: '图片发送失败，请重试。',
			};
		}

		const createdAt = createNextFixtureMessageTimestamp(record.timeline);
		const uploadedImageUrl = createFixtureObjectUrl(request.file);
		const message: ConversationMessage = {
			id: createMessageId(conversationId),
			conversationId,
			authoredAt: createdAt,
			author: createFixtureAuthor(currentUser),
			content: {
				format: 'markdown',
				text: trimmedText ?? '',
			},
			state: {
				edited: false,
				deleted: false,
			},
			attachments: [
				{
					kind: 'image',
					id: `${conversationId}-${createdAt}-image`,
					title: request.file.name,
					preview: {
						url: uploadedImageUrl,
					},
					source: {
						url: uploadedImageUrl,
					},
				},
			],
		};

		record.timeline.push(message);
		record.membership.inbox = zeroInboxState();
		record.unreadAnchorMessageId = undefined;
		record.conversation.lastActivityAt = createdAt;

		return cloneValue({
			message: stampMessageActions(message, currentUser.id),
			sync: buildMembershipSyncState(conversationId, {
				includeTimeline: true,
			}),
		});
	},
	membershipCommand: async (
		conversationId: string,
		request: MembershipCommandRequest,
	): Promise<MembershipCommandResponse> => {
		requireFixtureSessionUser();
		const record = requireFixtureConversationRecord(conversationId);

		switch (request.type) {
			case 'set-starred':
				record.membership.starred = request.value;
				return cloneValue({
					conversationId,
					sync: buildMembershipSyncState(conversationId),
				});
			case 'set-listing':
				record.membership.listing = request.value;
				return cloneValue({
					conversationId,
					sync: buildMembershipSyncState(conversationId),
				});
			case 'mark-read':
				record.membership.inbox = zeroInboxState();
				record.unreadAnchorMessageId = undefined;
				return cloneValue({
					conversationId,
					sync: buildMembershipSyncState(conversationId, {
						includeTimeline: true,
					}),
				});
			case 'mark-unread': {
				const targetMessageId = request.fromMessageId ?? record.timeline.at(-1)?.id;
				if (!targetMessageId) {
					throw {
						code: 'NOT_FOUND' as const,
						message: '未找到未读起点消息。',
					};
				}

				const targetIndex = record.timeline.findIndex((message) => message.id === targetMessageId);
				if (targetIndex < 0) {
					throw {
						code: 'NOT_FOUND' as const,
						message: '未找到未读起点消息。',
					};
				}

				record.membership.inbox = {
					unreadMessages: Math.max(record.timeline.length - targetIndex, 0),
					mentionCount: 0,
					replyCount: 0,
					hasThreadActivity: false,
					hasUncountedActivity: false,
				};
				record.unreadAnchorMessageId = targetMessageId;
				return cloneValue({
					conversationId,
					sync: buildMembershipSyncState(conversationId, {
						includeTimeline: true,
					}),
				});
			}
		}
	},
	lookupDirectConversation: async (userId: string): Promise<DirectConversationLookup> => {
		const currentUser = requireFixtureSessionUser();
		const targetUser = requireFixtureKnownUser(userId);
		if (targetUser.id === currentUser.id || userId === currentUser.id) {
			throw {
				code: 'VALIDATION_ERROR' as const,
				message: '不能与自己发起私信。',
			};
		}

		const existingConversationId = fixtureState.directConversationRoomIdByUserId[userId];
		const existingRecord = existingConversationId ? requireFixtureConversationRecord(existingConversationId) : null;

		return cloneValue({
			user: toFixtureUserSummary(targetUser),
			conversation:
				existingConversationId && existingRecord
					? {
							state: existingRecord.membership.listing,
							conversationId: existingConversationId,
					  }
					: {
							state: 'none',
					  },
		});
	},
	ensureDirectConversation: async (userId: string): Promise<EnsureDirectConversationResponse> => {
		const currentUser = requireFixtureSessionUser();
		const targetUser = requireFixtureKnownUser(userId);
		if (targetUser.id === currentUser.id || userId === currentUser.id) {
			throw {
				code: 'VALIDATION_ERROR' as const,
				message: '不能与自己发起私信。',
			};
		}

		const existingConversationId = fixtureState.directConversationRoomIdByUserId[userId];
		if (existingConversationId) {
			const existingRecord = requireFixtureConversationRecord(existingConversationId);
			if (existingRecord.membership.listing === 'hidden') {
				existingRecord.membership.listing = 'listed';
				return cloneValue({
					user: toFixtureUserSummary(targetUser),
					conversationId: existingConversationId,
					disposition: 'existing-hidden-opened',
					sync: buildMembershipSyncState(existingConversationId, {
						includeTimeline: true,
					}),
				});
			}

			return cloneValue({
				user: toFixtureUserSummary(targetUser),
				conversationId: existingConversationId,
				disposition: 'existing-listed',
				sync: buildMembershipSyncState(existingConversationId, {
					includeTimeline: true,
				}),
			});
		}

		const roomId = `dm-${targetUser.username}`;
		fixtureState.conversations[roomId] = createFixtureDirectConversationRecord({
			roomId,
			user: targetUser,
		});
		fixtureState.conversationOrder.push(roomId);
		fixtureState.participantUserIdsByConversationId[roomId] = [currentUser.id, targetUser.id];
		for (const mappedUserId of [targetUser.id, ...(targetUser.aliases ?? [])]) {
			fixtureState.directConversationRoomIdByUserId[mappedUserId] = roomId;
		}

		return cloneValue({
			user: toFixtureUserSummary(targetUser),
			conversationId: roomId,
			disposition: 'created',
			sync: buildMembershipSyncState(roomId, {
				includeTimeline: true,
			}),
		});
	},
	updateMessage: async (
		conversationId: string,
		messageId: string,
		request: UpdateMessageRequest,
	): Promise<UpdateMessageResponse> => {
		const currentUser = requireFixtureSessionUser();
		const record = requireFixtureConversationRecord(conversationId);
		const messageIndex = record.timeline.findIndex((m) => m.id === messageId);
		const message = messageIndex >= 0 ? record.timeline[messageIndex] : undefined;
		if (!message) {
			throw {
				code: 'NOT_FOUND' as const,
				message: '未找到目标消息。',
			};
		}

		if (message.author.id !== currentUser.id) {
			throw {
				code: 'UPSTREAM_REJECTED' as const,
				message: '无法编辑他人的消息。',
			};
		}

		const trimmedText = request.text.trim();
		if (!trimmedText) {
			throw {
				code: 'VALIDATION_ERROR' as const,
				message: '消息内容不能为空。',
			};
		}

		const updatedMessage: ConversationMessage = {
			...message,
			content: {
				format: 'markdown',
				text: trimmedText,
			},
			updatedAt: new Date().toISOString(),
			state: {
				...message.state,
				edited: true,
			},
		};

		record.timeline[messageIndex] = updatedMessage;

		return cloneValue({
			message: stampMessageActions(updatedMessage, currentUser.id),
			sync: buildMembershipSyncState(conversationId, {
				includeTimeline: true,
			}),
		});
	},
	deleteMessage: async (
		conversationId: string,
		messageId: string,
	): Promise<DeleteMessageResponse> => {
		const currentUser = requireFixtureSessionUser();
		const record = requireFixtureConversationRecord(conversationId);
		const messageIndex = record.timeline.findIndex((m) => m.id === messageId);
		const message = messageIndex >= 0 ? record.timeline[messageIndex] : undefined;
		if (!message) {
			throw {
				code: 'NOT_FOUND' as const,
				message: '未找到目标消息。',
			};
		}

		if (message.author.id !== currentUser.id) {
			throw {
				code: 'UPSTREAM_REJECTED' as const,
				message: '无法删除他人的消息。',
			};
		}

		record.timeline[messageIndex] = {
			...message,
			content: {
				format: 'markdown',
				text: '',
			},
			state: {
				edited: false,
				deleted: true,
			},
		};

		for (const m of record.timeline) {
			if (m.replyTo?.messageId === messageId) {
				m.replyTo = { ...m.replyTo, excerpt: '该消息已删除。', long: false };
			}
		}

		return cloneValue({
			messageId,
			sync: buildMembershipSyncState(conversationId, {
				includeTimeline: true,
			}),
		});
	},
	clearSession: () => {
		writeStoredSessionUser(null);
		resetFixtureState();
	},
	readSessionUser: () => cloneValue(readStoredSessionUser()),

};

const CODE_FENCE = '```';

export const shellRooms = [
	{ name: '运营协调', status: '12 人活跃', unread: 3, tone: 'accent' },
	{ name: 'Platform值班', status: '接口验证进行中', unread: 2, tone: 'neutral' },
	{ name: '客户交付', status: '26 分钟后交接', unread: 7, tone: 'warning' },
	{ name: 'Rocket.Chat 7.6兼容', status: '4 条待确认', unread: 4, tone: 'success' },
];

export const timelineMessages = [
	{
		id: 'm-0',
		author: '林澈',
		role: '运营',
		time: '08:11',
		tone: 'neutral',
		status: 'read',
		collapsed: false,
		body: '先记个起点：今天主要是交接说明、消息密度和上下文切换成本，不是单纯的渲染性能尖峰。',
	},
	{
		id: 'm-0a',
		author: '顾宁',
		role: '设计',
		time: '08:16',
		tone: 'success',
		status: 'read',
		collapsed: false,
		body: '这个壳层要像工作台，不要像 dashboard。侧栏、消息流、右侧说明都要尽量在同一层语气里。',
	},
	{
		id: 'm-0b',
		author: 'Alexander Chen',
		role: 'Platform',
		time: '08:21',
		tone: 'neutral',
		status: 'read',
		collapsed: false,
		body: `接口侧先按这个顺序摸底：

- 登录态与 token 续期
- 房间列表与 subscriptions
- 历史消息、thread、mention

只要这一段走顺，BetterChat 的第一阶段范围就比较清楚了。`,
	},
	{
		id: 'm-0c',
		author: '欧阳明远',
		role: '交付',
		time: '08:27',
		tone: 'accent',
		status: 'read',
		collapsed: false,
		body: '另外提醒一下，真实环境里很多房间不是短消息，而是长交接、长引用、补充说明混在一起，所以消息流的秩序感要比单条卡片更重要。',
	},
	{
		id: 'm-0d',
		author: 'Mia张',
		role: '设计',
		time: '08:34',
		tone: 'warning',
		status: 'read',
		collapsed: false,
		body: '如果用户已经读过的内容和未读内容没有自然分层，就很难形成“快速扫一遍，再深入某一条”的节奏。',
	},
	{
		id: 'm-1',
		author: '欧阳明远',
		role: '运营',
		time: '08:42',
		tone: 'accent',
		status: 'read',
		collapsed: false,
		thread: { replies: 2, lastReply: '周岚', time: '08:51' },
		body: '早班流程已经稳定下来，目前主要是交接说明过长，真正的系统负载并没有继续上升。BetterChat 第一阶段先把频道扫读速度做出来，比堆太多花样更重要。',
	},
	{
		id: 'm-2',
		author: 'Alexander Chen',
		role: 'Platform',
		time: '08:45',
		tone: 'neutral',
		status: 'read',
		collapsed: false,
		body: `补一个较长的同步说明，看看真实频道里的长消息是否仍然稳：

- 先验证 Rocket.Chat 7.6.0 的 REST / DDP 兼容行为
- 再打通房间列表、历史消息、thread 与 mention
- 最后再收敛 markdown、KaTeX、代码块和附件卡片的视觉纪律

这轮评审的重点不是“看起来新”，而是 **在复杂协作信息下仍然低噪、顺手、能扫读**。`,
	},
	{
		id: 'm-3',
		author: '陈Alex',
		role: '产品',
		time: '08:49',
		tone: 'warning',
		status: 'unread',
		collapsed: true,
		body: `这里给一个长消息 + 数学的组合场景：如果频道里要解释为什么高峰期等待会突然恶化，可以直接写成 $W_q \\approx \\frac{\\rho}{\\mu(1-\\rho)}$。真正重要的是，公式出现之后界面仍然像一个成熟产品，而不是像临时拼上的技术插件。

> BetterChat 的优势应该来自信息组织更有判断，而不是颜色更响亮。
>
> - 第一阶段先收敛 Rocket.Chat 7.6.0 兼容边界
> - 房间列表、消息流、thread 读取优先
> - 搜索、附件、更多增强交互放到后续迭代
>
> 如果队列压力继续抬高，可直接引用 $W_q \\approx \\frac{\\rho}{\\mu(1-\\rho)}$ 说明等待为何会突然变坏。
>
> \`chat.getMessage\` 与 \`loadHistory\` 的差异要先写进 spec。`,
	},
	{
		id: 'm-4',
		author: 'Mia张',
		role: '设计',
		time: '08:53',
		tone: 'success',
		status: 'unread',
		collapsed: false,
		replyTo: {
			author: '陈Alex',
			long: true,
			excerpt:
				'这里给一个长消息 + 数学的组合场景：如果频道里要解释为什么高峰期等待会突然恶化，可以直接写成 W_q ≈ ρ / μ(1−ρ)。BetterChat 的优势应该来自信息组织更有判断，而不是颜色更响亮。',
		},
		body: '我同意。深色主题里如果代码块、引用块、公式卡片各说各话，用户会立刻感觉这不是同一个产品。我们的目标是让复杂内容自然落到统一界面语言里。',
	},
	{
		id: 'm-5',
		author: '周岚',
		role: '平台',
		time: '08:58',
		tone: 'neutral',
		status: 'unread',
		collapsed: true,
		replyTo: {
			author: 'Alexander Chen',
			kind: 'plain',
			excerpt: '先验证 Rocket.Chat 7.6.0 的 REST / DDP 兼容行为，再打通房间列表、历史消息、 thread 与 mention。',
		},
		thread: { replies: 3, lastReply: '顾宁', time: '09:10' },
		body: `顺便把接口草稿也放进主消息流里，看看技术内容的边界是否足够克制：

${CODE_FENCE}ts
const draft = {
	rid: 'GENERAL',
	tmid: 'handoff-7-6-0',
	parseUrls: true,
	msg: '请在 17:30 前同步 BetterChat 验证结论。',
};
${CODE_FENCE}

如果这种消息一出现就像换了另一个前端系统，那这套设计就还没有真正收干净。`,
	},
	{
		id: 'm-6',
		author: '顾宁',
		role: '设计',
		time: '09:04',
		tone: 'success',
		status: 'unread',
		collapsed: false,
		body: '最后补一句：如果浮层按钮真的要出现，它们应该像阅读辅助，而不是像悬浮运营入口。出现时机要晚，形态也要轻。',
	},
	{
		id: 'm-6a',
		author: 'Alexander Chen',
		role: 'Platform',
		time: '09:07',
		tone: 'neutral',
		status: 'unread',
		collapsed: false,
		body: `再补一个块级公式场景，确认消息流里出现独立公式时，前后段落仍然稳：

$$
T_{total}=T_{auth}+T_{sync}+T_{paint}
$$

如果要解释历史拉取与界面渲染为什么会一起拖慢体验，也可能会写成：

$$
\\Delta t \\approx \\frac{n_{history}}{r_{fetch}}+\\frac{n_{nodes}}{r_{paint}}
$$

重点不是公式本身，而是它进入频道之后，整条消息仍然要像协作信息，而不是像论文附件。`,
	},
	{
		id: 'm-7',
		author: '欧阳明远',
		role: '交付',
		time: '09:09',
		tone: 'accent',
		status: 'unread',
		collapsed: false,
		replyTo: {
			author: '周岚',
			kind: 'code',
			excerpt: 'draft payload · rid: GENERAL · tmid: handoff-7-6-0 · parseUrls: true',
		},
		body: '这个 payload 的方向没有问题，但消息输入区最好不要把这些字段暴露给普通用户。它应该由客户端在内部收敛，界面层只负责更清楚地表达意图。',
	},
	{
		id: 'm-8',
		author: '林澈',
		role: '运营',
		time: '09:12',
		tone: 'warning',
		status: 'unread',
		collapsed: false,
		replyTo: {
			author: '顾宁',
			kind: 'quote',
			excerpt: '浮层按钮应该像阅读辅助，而不是悬浮运营入口。出现时机要晚，形态也要轻。',
		},
		body: '对运营来说，这一点很重要。真正高频的是“继续往下读”和“回到刚刚未读的位置”，不是多一个显眼操作按钮。',
	},
];

export const systemTokens = {
	柏木: ['#35584b', '#7f9f90', '#22382f'],
	橄榄: ['#7e8560', '#a1ac88', '#5f6647'],
	陶土: ['#a06a4d', '#c79272', '#744936'],
	石色: ['#f4efe6', '#fbf7f0', '#151c1d'],
	文字: ['#1d1a16', '#5b5149', '#a89d91'],
};

export const markdownReference = `
# Markdown 与公式渲染评审

这块内容不是展示页，而是为了验证 BetterChat 在真实协作场景下是否能稳定地承载：

- **Markdown 强调与层级**
- GFM 表格、任务列表、删除线
- 行内代码与代码块
- 行内公式 $E = mc^2$
- 块级公式
- 长消息里 Rocket.Chat 7.6.0 与 BetterChat 的中英混排

> 如果这套界面只能承载普通纯文本，那么设计系统并没有真正完成。

## 任务状态

- [x] Markdown 基础格式
- [x] KaTeX 数学公式
- [x] 中文段落与列表
- [x] 中英混排的 pangu 风格空隙
- [ ] 附件卡片样式

## 同步策略

当前的同步优先级可以抽象为：

$$
\\operatorname{priority}(r_i)=
\\alpha \\cdot \\operatorname{unread}(r_i)+
\\beta \\cdot \\operatorname{mention}(r_i)+
\\gamma \\cdot \\operatorname{handoff}(r_i)
$$

其中：

| 字段 | 含义 | 示例 |
| --- | --- | --- |
| \`unread\` | 未读消息数量 | \`12\` |
| \`mention\` | 是否被点名 | \`0 / 1\` |
| \`handoff\` | 是否临近交接 | \`0 / 1\` |

## 行内样式

当用户写下 \`/topic 值班切换\` 时，界面应该让命令、正文、公式和引用都保持同一套语言。

例如，估算 5 分钟内收到回复的概率：

$$
P(\text{reply within } 5m)=1-e^{-\lambda t}
$$

如果一条消息同时提到 BetterChat、Rocket.Chat 7.6.0、KaTeX 与 markdown，段落依然要顺着读下去，而不是突然断气。

## 复杂引用块

> 这类引用块不只是一句短句，而是经常承担“转述结论”“同步上下文”“保留决策日志”的职责。
>
> - Rocket.Chat 7.6.0 作为第一阶段兼容目标
> - BetterChat shell 先聚焦桌面端与高频流程
> - mixed-language 文案默认走 pangu 风格排版
>
> 如果要解释高峰排队的突然恶化，可以直接写成 $W_q \\approx \\frac{\\rho}{\\mu(1-\\rho)}$。
>
> 同时，像 \`chat.getMessage\`、\`loadHistory\` 这样的接口名，也应该在引用块里保持清楚但不刺眼。

## 代码片段

${CODE_FENCE}ts
type ComposerPayload = {
	rid: string;
	msg: string;
	tmid?: string;
	parseUrls: boolean;
};

const payload: ComposerPayload = {
	rid: 'GENERAL',
	msg: '请在 17:30 前确认交接表。',
	parseUrls: true,
};
${CODE_FENCE}

## 评审标准

1. 标题是否稳定，不像文档站模板。
2. 中文段落是否顺滑，不显得拥挤。
3. 表格、公式、代码块是否都属于同一个产品。
4. 长消息场景是否还能快速扫读。
`;

export const markdownMessages = [
	{
		id: 'md-1',
		author: '欧阳明远',
		role: '交付',
		time: '09:12',
		tone: 'accent',
		body: `这条消息需要同时覆盖 **强调**、\`行内代码\`、混排的 BetterChat / Rocket.Chat 7.6.0，以及行内公式 $S = vt$，看气质是不是统一。`,
	},
	{
		id: 'md-2',
		author: 'Alexander Chen',
		role: 'Platform',
		time: '09:16',
		tone: 'neutral',
		body: `同步方案先记三点：

- 主频道保持简洁
- 长说明尽量折叠
- 关键结论放在第一屏
- 技术细节允许展开，但不要破坏主消息流`,
	},
	{
		id: 'md-3',
		author: '陈Alex',
		role: '产品',
		time: '09:18',
		tone: 'warning',
		body: `这里还有一个表格要看：

| 模块 | 目标 |
| --- | --- |
| 消息流 | 更快扫读 |
| 输入区 | 更少噪音 |
| thread | 第二阶段 |
| 附件 | 后续迭代 |`,
	},
	{
		id: 'md-4',
		author: 'Mia张',
		role: '设计',
		time: '09:22',
		tone: 'success',
		body: `块级公式也要成立：

$$
\\Delta t = t_{\\text{handoff}} - t_{\\text{now}}
$$

如果公式一出现就把界面气质打断，这套设计就还不够稳。`,
	},
];

export const showcaseMessages = [
	{
		id: 'show-1',
		author: '欧阳明远',
		role: '交付',
		time: '10:14',
		tone: 'accent',
		title: '超长交接消息',
		tags: ['长消息', '混排', '结论优先'],
		body: `今天的交接需要一次讲清楚三个层面：界面节奏、Rocket.Chat 7.6.0 兼容性，以及上线方式的低侵入约束。

第一，主频道要保持可扫读，**第一屏必须先给结论**。第二，长说明可以继续展开，但不能让读者在巨量文字里自己找优先级。第三，如果最终采用 proxy 方案，前端与中间层的职责边界要写得非常清楚。

- 房间列表与消息流优先做稳
- thread、附件、搜索按迭代推进
- mixed-language 文案默认走 pangu 风格排版

> 这条消息的重点不是“内容很多”，而是“内容很多时仍然能被读完”。`,
	},
	{
		id: 'show-2',
		author: 'Alexander Chen',
		role: 'Platform',
		time: '10:18',
		tone: 'neutral',
		title: '数学解释消息',
		tags: ['公式', '解释', '运营语境'],
		body: `如果要解释为什么高峰时段的等待会突然恶化，可以把直觉写成一个很短的模型：

$$
W_q \\approx \\frac{\\rho}{\\mu(1-\\rho)}
$$

当 $\\rho \\to 1$ 时，等待时间会明显放大，所以界面里 **队列状态、未读量、交接时刻** 需要同时可见，而不是分散到多个二级面板。

这类消息不应该只对工程师友好，也要让运营同学在十几秒里抓到真正的结论。`,
	},
	{
		id: 'show-3',
		author: '陈Alex',
		role: '产品',
		time: '10:22',
		tone: 'warning',
		title: '代码与决策并存',
		tags: ['代码', '列表', '技术频道'],
		body: `这里模拟一条开发频道里的长消息，既要能放 checklist，也要能容纳一小段代码：

1. 先打通 \`chat.getMessage\` 与 \`loadHistory\`
2. 再确认 thread 读取兼容 7.6.0
3. 最后验证 markdown、KaTeX、emoji 与代码块

${CODE_FENCE}ts
const draft = {
	rid: 'GENERAL',
	tmid: 'handoff-7-6-0',
	parseUrls: true,
	msg: '请在 17:30 前同步 BetterChat 验证结论。',
};
${CODE_FENCE}

如果这类消息在视觉上太跳，工程频道就会很快变得难用。`,
	},
	{
		id: 'show-4',
		author: 'Mia张',
		role: '设计',
		time: '10:27',
		tone: 'success',
		title: '引用与决策日志',
		tags: ['表格', '引用', '产品评审'],
		body: `这类评审消息经常是中英混排 + decision log：

| 项目 | 结论 |
| --- | --- |
| Rocket.Chat 7.6.0 | 作为首个兼容目标 |
| BetterChat shell | 先做桌面端优先 |
| mobile | 暂不作为首要目标 |

> “现代”不是把界面做得更像海报，而是让 \`context / action / content\` 的层次在几秒内被看懂。`,
	},
	{
		id: 'show-5',
		author: '周岚',
		role: '平台',
		time: '10:31',
		tone: 'neutral',
		title: '复杂引用块压力测试',
		tags: ['复杂引用', '列表', '行内代码'],
		body: `这条消息专门测试引用块里放更多结构时，整体对齐是否还稳：

> 先说结论：BetterChat 第一阶段的目标不是“完全替代官方客户端”，而是把高频协作路径做顺。
>
> 需要先锁定三件事：
>
> 1. Rocket.Chat 7.6.0 的消息读取与发送兼容
> 2. 主消息流、thread、mention 的阅读效率
> 3. proxy 边界与前端状态模型是否足够清楚
>
> 如果队列进入高压区，可以用 $W_q \\approx \\frac{\\rho}{\\mu(1-\\rho)}$ 解释等待为什么突然抬升。
>
> 同时，\`chat.getMessage\`、\`subscriptions.get\`、\`loadHistory\` 这些接口名要保持可辨认，但不能把整条消息变成文档站截图。

如果这段内容还能平静地立住，说明引用块的对齐和节奏就基本过关了。`,
	},
];

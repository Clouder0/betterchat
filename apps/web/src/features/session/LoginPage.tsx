import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';

import { Button, Panel, Tag } from '@/components/ui';
import { betterChatApi, betterChatQueryKeys, isBetterChatApiError } from '@/lib/betterchat';
import { spaceText } from '@/lib/text';
import styles from './LoginPage.module.css';

const defaultFormState =
	betterChatApi.mode === 'fixture'
		? {
				login: 'linche',
				password: 'demo',
				code: '',
		  }
		: {
				login: '',
				password: '',
				code: '',
		  };

export const LoginPage = () => {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [formState, setFormState] = useState(defaultFormState);

	const publicBootstrapQuery = useQuery({
		queryKey: betterChatQueryKeys.publicBootstrap,
		queryFn: () => betterChatApi.publicBootstrap(),
	});

	useEffect(() => {
		if (!publicBootstrapQuery.data?.session.authenticated) {
			return;
		}

		void navigate({
			to: '/app',
			replace: true,
		});
	}, [navigate, publicBootstrapQuery.data?.session.authenticated]);

	const loginMutation = useMutation({
		mutationFn: () =>
			betterChatApi.login({
				login: formState.login,
				password: formState.password,
				code: formState.code.trim() || undefined,
			}),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: betterChatQueryKeys.publicBootstrap }),
				queryClient.invalidateQueries({ queryKey: betterChatQueryKeys.workspace }),
				queryClient.invalidateQueries({ queryKey: betterChatQueryKeys.roomList }),
			]);

			await navigate({ to: '/app', replace: true });
		},
	});

	const errorMessage = useMemo(() => {
		if (loginMutation.error && isBetterChatApiError(loginMutation.error)) {
			return loginMutation.error.message;
		}

		if (publicBootstrapQuery.error && isBetterChatApiError(publicBootstrapQuery.error)) {
			return publicBootstrapQuery.error.message;
		}

		return null;
	}, [loginMutation.error, publicBootstrapQuery.error]);

	const siteName = publicBootstrapQuery.data?.server.siteName ?? 'BetterChat';
	const serverVersion = publicBootstrapQuery.data?.server.version ?? '7.6.0';
	const providers = publicBootstrapQuery.data?.login.registeredProviders ?? [];
	const passwordEnabled = publicBootstrapQuery.data?.login.passwordEnabled ?? true;

	return (
		<div className={styles.page} data-testid='login-page' data-theme-surface='true'>
			<div className={styles.backdrop} data-theme-surface='true' />
			<div className={styles.content}>
				<section className={styles.hero}>
					<p className={styles.eyebrow}>{spaceText('Rocket.Chat 7.6.0 独立客户端')}</p>
					<h1 className={styles.title}>BetterChat</h1>
					<p className={styles.description}>
						{spaceText('第一阶段先把登录、侧栏、房间打开与消息阅读做成一条低噪、稳定、可验证的主路径。')}
					</p>
					<div className={styles.metaRow}>
						<Tag tone='accent'>{siteName}</Tag>
						<Tag tone='support'>{serverVersion}</Tag>
						<Tag tone={betterChatApi.mode === 'fixture' ? 'warning' : 'neutral'}>
							{betterChatApi.mode === 'fixture' ? '合同夹具模式' : 'BetterChat API'}
						</Tag>
					</div>

					{providers.length > 0 ? (
						<div className={styles.providerBlock}>
							<p className={styles.providerLabel}>{spaceText('已配置登录方式')}</p>
							<div className={styles.providerList}>
								{providers.map((provider) => (
									<Tag key={provider.name} tone='neutral'>
										{provider.label}
									</Tag>
								))}
							</div>
						</div>
					) : null}
				</section>

				<Panel className={styles.card} data-theme-surface='true'>
					<div className={styles.cardHeader}>
						<div>
							<p className={styles.cardEyebrow}>{spaceText('登录 BetterChat')}</p>
							<h2 className={styles.cardTitle}>{spaceText('进入工作区')}</h2>
						</div>
						<p className={styles.cardHint}>{spaceText('注册暂不在本阶段范围内。')}</p>
					</div>

					<form
						className={styles.form}
						data-testid='login-form'
						onSubmit={(event) => {
							event.preventDefault();
							loginMutation.mutate();
						}}
					>
						<label className={styles.field}>
							<span className={styles.fieldLabel}>{spaceText('账号')}</span>
							<input
								className={styles.input}
								data-testid='login-input'
								autoComplete='username'
								name='login'
								onChange={(event) =>
									setFormState((currentState) => ({
										...currentState,
										login: event.target.value,
									}))
								}
								placeholder={spaceText('用户名或邮箱')}
								value={formState.login}
							/>
						</label>

						<label className={styles.field}>
							<span className={styles.fieldLabel}>{spaceText('密码')}</span>
							<input
								className={styles.input}
								data-testid='password-input'
								autoComplete='current-password'
								name='password'
								onChange={(event) =>
									setFormState((currentState) => ({
										...currentState,
										password: event.target.value,
									}))
								}
								placeholder={spaceText('输入密码')}
								type='password'
								value={formState.password}
							/>
						</label>

						<label className={styles.field}>
							<span className={styles.fieldLabel}>{spaceText('双因素代码（可选）')}</span>
							<input
								className={styles.input}
								name='code'
								onChange={(event) =>
									setFormState((currentState) => ({
										...currentState,
										code: event.target.value,
									}))
								}
								placeholder={spaceText('仅在服务端要求时填写')}
								value={formState.code}
							/>
						</label>

						{errorMessage ? (
							<div
								className={styles.errorMessage}
								data-testid='login-error'
								role='alert'
								aria-live='assertive'
							>
								{spaceText(errorMessage)}
							</div>
						) : null}

						<div className={styles.actions}>
							<Button disabled={!passwordEnabled || loginMutation.isPending} type='submit'>
								{loginMutation.isPending ? '正在登录…' : '登录'}
							</Button>
							<p className={styles.actionHint}>
								{betterChatApi.mode === 'fixture'
									? spaceText('夹具模式下使用任意非空账号密码即可进入。')
									: spaceText('浏览器只通过 BetterChat 后端访问会话与数据。')}
							</p>
						</div>
					</form>
				</Panel>
			</div>
		</div>
	);
};

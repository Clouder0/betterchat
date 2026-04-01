import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRootRoute, createRoute, createRouter, Outlet, useRouterState } from '@tanstack/react-router';
import { Suspense, lazy, useMemo, useState, useCallback } from 'react';
import type { ComponentType } from 'react';

import { ThemeProvider } from '@/app/ThemeProvider';
import { AppFrame } from '@/components/AppFrame';
import { AppShell } from '@/features/app-shell/AppShell';
import { LoginPage } from '@/features/session/LoginPage';
import { ErrorBoundary } from '@/components/error/ErrorBoundary';
import { RouteErrorFallback } from '@/components/error/RouteErrorFallback';
import '@/styles/global.css';

const OverviewPage = lazy(async () => ({ default: (await import('@/pages/OverviewPage')).OverviewPage }));
const ShellPage = lazy(async () => ({ default: (await import('@/pages/ShellPage')).ShellPage }));
const ContentPage = lazy(async () => ({ default: (await import('@/pages/ContentPage')).ContentPage }));
const SystemPage = lazy(async () => ({ default: (await import('@/pages/SystemPage')).SystemPage }));

const reviewRoutes = new Set(['/', '/shell', '/system', '/content']);

const LazyRoute = ({ component: Component }: { component: ComponentType }) => (
	<Suspense fallback={null}>
		<Component />
	</Suspense>
);

// Error handler for route-level errors
const handleRouteError = (error: Error): void => {
	console.error('Route error boundary caught an error:', error);
	// Could send to error tracking service here
};

const RootLayout = () => {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const [errorKey, setErrorKey] = useState(0);

	// Reset error boundary when route changes
	const resetError = useCallback(() => {
		setErrorKey((prev) => prev + 1);
	}, []);

	const content = (
		<ErrorBoundary
			fallback={
				<RouteErrorFallback
					error={new Error('页面渲染失败')}
					reset={resetError}
				/>
			}
			onError={handleRouteError}
			resetKeys={[pathname, errorKey]}
		>
			<Outlet />
		</ErrorBoundary>
	);

	return <ThemeProvider>{reviewRoutes.has(pathname) ? <AppFrame>{content}</AppFrame> : content}</ThemeProvider>;
};

const rootRoute = createRootRoute({
	component: RootLayout,
});

const overviewRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/',
	component: () => <LazyRoute component={OverviewPage} />,
});

const shellRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/shell',
	component: () => <LazyRoute component={ShellPage} />,
});

const systemRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/system',
	component: () => <LazyRoute component={SystemPage} />,
});

const contentRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/content',
	component: () => <LazyRoute component={ContentPage} />,
});

const loginRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/login',
	component: LoginPage,
});

const appRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/app',
	component: () => <AppShell />,
});

const appRoomRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/app/rooms/$roomId',
	component: function AppRoomRoute() {
		const { roomId } = appRoomRoute.useParams();
		return <AppShell roomId={roomId} />;
	},
});

const routeTree = rootRoute.addChildren([overviewRoute, shellRoute, systemRoute, contentRoute, loginRoute, appRoute, appRoomRoute]);

const router = createRouter({
	routeTree,
});

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router;
	}
}

export const App = () => {
	const queryClient = useMemo(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: {
						retry: false,
						refetchOnWindowFocus: false,
					},
				},
			}),
		[],
	);

	return (
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	);
};

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type { PropsWithChildren, ReactElement } from 'react';

import { ThemeProvider } from '@/app/ThemeProvider';

export const createTestQueryClient = () =>
	new QueryClient({
		defaultOptions: {
			mutations: {
				retry: false,
			},
			queries: {
				gcTime: 0,
				refetchOnReconnect: false,
				refetchOnWindowFocus: false,
				retry: false,
				staleTime: 0,
			},
		},
	});

export const renderWithAppProviders = (
	ui: ReactElement,
	{
		queryClient = createTestQueryClient(),
		renderOptions,
		withTheme = true,
	}: {
		queryClient?: QueryClient;
		renderOptions?: Omit<RenderOptions, 'wrapper'>;
		withTheme?: boolean;
	} = {},
) => {
	const Wrapper = ({ children }: PropsWithChildren) => (
		<QueryClientProvider client={queryClient}>{withTheme ? <ThemeProvider>{children}</ThemeProvider> : children}</QueryClientProvider>
	);

	return {
		queryClient,
		...render(ui, {
			wrapper: Wrapper,
			...renderOptions,
		}),
	};
};

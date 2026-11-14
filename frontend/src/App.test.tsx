import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'

import App from './App'

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

test('shows API status from /api/healthz', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(Response.json({ status: 'ok', version: 'abc123' }))),
  )
  renderApp()
  expect(await screen.findByText('API ok (abc123)')).toBeInTheDocument()
})

test('shows unreachable when /api/healthz fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('', { status: 503 }))),
  )
  renderApp()
  expect(await screen.findByText('API unreachable')).toBeInTheDocument()
})

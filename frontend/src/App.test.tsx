import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'

import App from './App'

// WebGL is not available in jsdom; the map has its own browser checks (verify-ui, perf script).
vi.mock('./features/map/MapView', () => ({ default: () => <div data-testid="map" /> }))

test('renders the trip form with submit disabled and the empty-state text', async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>,
  )
  expect(screen.getByRole('form', { name: 'Trip' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Plan route' })).toBeDisabled()
  expect(screen.getByText(/compare three routes by weather risk/)).toBeInTheDocument()
  expect(await screen.findByTestId('map')).toBeInTheDocument()
})

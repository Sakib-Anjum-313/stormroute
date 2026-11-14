import { useQuery } from '@tanstack/react-query'

import { fetchHealth } from './lib/api/client'

export default function App() {
  const health = useQuery({ queryKey: ['healthz'], queryFn: ({ signal }) => fetchHealth(signal) })

  return (
    <main className="flex h-full flex-col items-center justify-center gap-2 p-4">
      <h1 className="text-2xl font-semibold">Spotter · Weather-Aware Truck Routing</h1>
      <output className="text-sm text-gray-500">
        {health.isPending && 'Connecting to API…'}
        {health.isError && 'API unreachable'}
        {health.isSuccess && `API ${health.data.status} (${health.data.version})`}
      </output>
    </main>
  )
}

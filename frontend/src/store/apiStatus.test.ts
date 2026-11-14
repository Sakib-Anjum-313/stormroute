import { useApiStatus, watchApiHealth, type HealthDeps } from './apiStatus'

beforeEach(() => {
  vi.useFakeTimers()
  useApiStatus.setState({ status: 'checking' })
})
afterEach(() => vi.useRealTimers())

function deps(probe: HealthDeps['probe']): HealthDeps {
  return {
    probe,
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }
}

const after = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const status = () => useApiStatus.getState().status

test('a fast answer goes straight to ready without the waking notice', async () => {
  watchApiHealth(deps(() => after(300)))
  expect(status()).toBe('checking')
  await vi.advanceTimersByTimeAsync(300)
  expect(status()).toBe('ready')
  await vi.advanceTimersByTimeAsync(5_000)
  expect(status()).toBe('ready')
})

test('a slow answer shows waking after 2 s, then ready', async () => {
  watchApiHealth(deps(() => after(8_000)))
  await vi.advanceTimersByTimeAsync(1_999)
  expect(status()).toBe('checking')
  await vi.advanceTimersByTimeAsync(1)
  expect(status()).toBe('waking')
  await vi.advanceTimersByTimeAsync(6_000)
  expect(status()).toBe('ready')
})

test('failures retry until the API answers', async () => {
  let calls = 0
  watchApiHealth(
    deps(() => {
      calls++
      return calls < 3 ? Promise.reject(new Error('502')) : Promise.resolve()
    }),
  )
  await vi.advanceTimersByTimeAsync(0)
  expect(status()).toBe('waking')
  await vi.advanceTimersByTimeAsync(4_000)
  expect(calls).toBe(3)
  expect(status()).toBe('ready')
})

test('a probe that hangs is aborted and retried; it gives up after 90 s', async () => {
  const seen: AbortSignal[] = []
  watchApiHealth(
    deps(
      (signal) =>
        new Promise((_resolve, reject) => {
          seen.push(signal)
          signal.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    ),
  )
  await vi.advanceTimersByTimeAsync(10_000)
  expect(seen[0]?.aborted).toBe(true)
  expect(status()).toBe('waking')
  await vi.advanceTimersByTimeAsync(90_000)
  expect(status()).toBe('unreachable')
})

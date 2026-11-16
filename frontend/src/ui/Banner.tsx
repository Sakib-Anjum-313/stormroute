import type { ReactNode } from 'react'

export type BannerTone = 'info' | 'warning' | 'danger'

const TONE: Record<BannerTone, string> = {
  info: 'border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-800/60 dark:bg-sky-950/40 dark:text-sky-100',
  warning:
    'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100',
  danger:
    'border-red-300 bg-red-50 text-red-950 dark:border-red-800/70 dark:bg-red-950/40 dark:text-red-100',
}

const ICON: Record<BannerTone, string> = { info: 'i', warning: '!', danger: '!' }

/** A message strip. The icon and the title carry the tone, so it is never color alone. */
export function Banner({
  tone,
  title,
  children,
  live,
  testId,
  icon,
}: {
  tone: BannerTone
  title: string
  children?: ReactNode
  /** `assertive` renders an alert, `polite` a status output; omit for a static strip. */
  live?: 'assertive' | 'polite'
  testId?: string
  /** Replaces the default tone icon (the cold-start banner shows a spinner). */
  icon?: ReactNode
}) {
  const Tag = live === 'polite' ? 'output' : 'div'
  return (
    <Tag
      {...(live === 'assertive' ? { role: 'alert' } : {})}
      data-testid={testId}
      className={`animate-fade flex gap-2.5 rounded-xl border p-3 text-sm ${TONE[tone]}`}
    >
      {icon ?? (
        <span
          aria-hidden
          className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full border border-current text-[10px] font-bold"
        >
          {ICON[tone]}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        {children && <span className="mt-0.5 block text-[13px] opacity-90">{children}</span>}
      </span>
    </Tag>
  )
}

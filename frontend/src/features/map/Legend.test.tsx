import { render, screen, within } from '@testing-library/react'

import { Legend } from './Legend'

test.each([false, true])('every level has a text label (compact: %s)', (compact) => {
  render(<Legend compact={compact} />)
  const items = within(screen.getByRole('list', { name: 'Risk levels' })).getAllByRole('listitem')
  expect(items.map((li) => li.textContent)).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^Low/),
      expect.stringMatching(/^Moderate/),
      expect.stringMatching(/^High/),
      expect.stringMatching(/^Severe/),
      expect.stringMatching(/^No Travel/),
      expect.stringMatching(/^No data/),
    ]),
  )
  expect(items).toHaveLength(6)
})

test('the full legend has rule hints and the map symbols behind a disclosure', () => {
  render(<Legend />)
  expect(screen.getByText('wind 55+ · rain >1 · snow >3')).toBeInTheDocument()
  expect(screen.getByText(/over 30,000 lb, wind 45\+ is No Travel/)).toBeInTheDocument()
  expect(screen.getByRole('list', { name: 'Map symbols' })).toHaveTextContent(
    'Hours-of-service stop',
  )
})

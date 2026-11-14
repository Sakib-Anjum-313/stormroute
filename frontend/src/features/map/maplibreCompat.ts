import type { Map as MaplibreMap } from 'maplibre-gl'

/**
 * deck.gl 9.4's `@deck.gl/mapbox` reads `map.transform` (viewport near/far planes and height),
 * which MapLibre 6 moved to `map._camera.transform`. Without this getter every interleaved draw
 * throws. Remove once `@deck.gl/mapbox` supports MapLibre 6.
 */
export function exposeTransformForDeck(map: MaplibreMap): void {
  if ('transform' in map) return
  Object.defineProperty(map, 'transform', {
    // oxlint-disable-next-line no-underscore-dangle -- MapLibre 6 internal, see above
    get: () => map._camera.transform,
    configurable: true,
  })
}

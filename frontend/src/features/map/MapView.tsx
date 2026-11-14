import { MapboxOverlay } from '@deck.gl/mapbox'
import { Map as MaplibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useEffect, useRef, useState } from 'react'

import { MapPopover } from './MapPopover'
import { exposeTransformForDeck } from './maplibreCompat'
import { useTheme, type Theme } from '../../store/theme'
import { createScene } from './scene'

const BASEMAP_STYLE: Record<Theme, string> = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
}
// MapLibre derives its worker URL from its own module URL, which Vite's dependency bundling
// rewrites. Let Vite build the worker as a worker entry and point MapLibre at it.
setWorkerUrl(workerUrl)

const US_CENTER: [number, number] = [-98.5, 39.5]

/**
 * MapLibre basemap with an interleaved deck.gl overlay. It renders twice (mount, then once the map
 * exists): the scene controller pushes store changes into the overlay directly, and only the
 * popover child subscribes to hover and click picks.
 */
export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  // Set once when the map is created; only the popover reads it.
  const [map, setMap] = useState<MaplibreMap | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const instance = new MaplibreMap({
      container,
      style: BASEMAP_STYLE[useTheme.getState().theme],
      center: US_CENTER,
      zoom: 3.4,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    })
    exposeTransformForDeck(instance)
    // The OpenFreeMap dark style references a sprite icon ("circle-11") its sprite sheet lacks;
    // answer such requests with a transparent pixel instead of a console warning per tile.
    instance.setMissingStyleImageResolver((id) => {
      if (!instance.hasImage(id))
        instance.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) })
    })
    instance.touchZoomRotate.disableRotation()
    instance.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    const overlay = new MapboxOverlay({
      interleaved: true,
      layers: [],
      getCursor: ({ isDragging, isHovering }) =>
        isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab',
    })
    instance.addControl(overlay)
    const scene = createScene(instance, overlay)
    // Theme changes swap the basemap style; the scene re-attaches the deck layers afterwards.
    const unsubscribeTheme = useTheme.subscribe((state, prev) => {
      if (state.theme !== prev.theme) scene.setBasemap(BASEMAP_STYLE[state.theme], state.theme)
    })
    setMap(instance)
    return () => {
      setMap(null)
      unsubscribeTheme()
      scene.dispose()
      instance.removeControl(overlay)
      instance.remove()
    }
  }, [])

  // MapLibre sets `position: relative` on its container, so the container fills a positioned box.
  return (
    <section className="absolute inset-0" aria-label="Route map">
      <div ref={containerRef} className="h-full w-full" data-testid="map" />
      {map && <MapPopover map={map} />}
    </section>
  )
}

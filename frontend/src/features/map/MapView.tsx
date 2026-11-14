import { MapboxOverlay } from '@deck.gl/mapbox'
import { Map as MaplibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useEffect, useRef, useState } from 'react'

import { MapPopover } from './MapPopover'
import { exposeTransformForDeck } from './maplibreCompat'
import { createScene } from './scene'

export const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron'
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
      style: BASEMAP_STYLE,
      center: US_CENTER,
      zoom: 3.4,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    })
    exposeTransformForDeck(instance)
    instance.touchZoomRotate.disableRotation()
    instance.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    const overlay = new MapboxOverlay({
      interleaved: true,
      layers: [],
      getCursor: ({ isDragging, isHovering }) =>
        isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab',
    })
    instance.addControl(overlay)
    const disposeScene = createScene(instance, overlay)
    setMap(instance)
    return () => {
      setMap(null)
      disposeScene()
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

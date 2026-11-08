import { useEffect, useRef, useState, type RefObject } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { GeoFeatureCollection } from "@workspace/api-client-react";
import { dotTooltip, type SaleDot } from "@/lib/dots";
import { featureId, type MapFeature } from "@/lib/areas";
import { arrLabel } from "@/lib/fmt";
import { useChartColors } from "@/components/ui-bits";
import { t } from "@/lib/i18n/messages";

const reduceMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Far enough out to frame Paris and the nearby Communes; Fontainebleau and Meaux need a zoom out.
const HOME = { center: [48.85, 2.38] as [number, number], zoom: 11 };

/** One dot per position and Area, with one shared tooltip and one click handler for all of them. */
function PointsLayer({ dots, scale, nameOf, onSelect }: { dots: SaleDot[]; scale: (v: number) => string; nameOf: RefObject<(d: SaleDot) => string>; onSelect: RefObject<(d: SaleDot) => void> }) {
  const map = useMap();
  useEffect(() => {
    const group = L.featureGroup();
    const dotOf = new Map<L.Layer, SaleDot>();
    for (const d of dots) {
      const m = L.circleMarker([d.lat, d.lon], { radius: d.radius, weight: 0, fillOpacity: 0.78, fillColor: scale(d.medianPricePerSqm) });
      dotOf.set(m, d);
      group.addLayer(m);
    }
    group.bindTooltip((layer) => {
      const d = dotOf.get(layer);
      return d ? dotTooltip(d, nameOf.current(d)) : "";
    }, { className: "pt", sticky: true });
    group.on("click", (e) => {
      const d = dotOf.get(e.propagatedFrom as L.Layer);
      if (d) onSelect.current(d);
    });
    group.addTo(map);
    return () => { group.remove(); };
  }, [dots, scale, map, nameOf, onSelect]);
  return null;
}

/** Leaflet measures its box once. A map hidden on a phone (the Map / List tabs) or resized must measure it again. */
function AutoResize() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

/**
 * The page scrolls past the map. A plain wheel or a one-finger swipe moves the page, not the map; Ctrl or Cmd with the
 * wheel (and a trackpad pinch, which sends the same) zooms, and two fingers move and zoom the map on a phone.
 */
function GestureGuard({ onHint }: { onHint: (text: string) => void }) {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    // A trackpad pinch sends dozens of small wheel events with ctrlKey. Their deltaY adds up, and each
    // 100 of it (about one mouse wheel notch) is one zoom level, applied at most once per frame.
    let delta = 0, frame = 0, at = L.point(0, 0);
    const zoom = () => {
      frame = 0;
      const steps = Math.trunc(-delta / 100);
      if (!steps) return;
      delta += steps * 100;
      const z = Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), map.getZoom() + steps));
      if (z !== map.getZoom()) map.setZoomAround(at, z);
    };
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        // deltaY can be in lines (deltaMode 1, Firefox sends 3 per mouse notch) or pages (deltaMode 2, 1 per notch).
        // 100 / 3 per line and 100 per page turn one notch into 100, one level, as a 100 px notch in pixel mode.
        delta += e.deltaY * (e.deltaMode === 1 ? 100 / 3 : e.deltaMode === 2 ? 100 : 1);
        at = map.mouseEventToContainerPoint(e as unknown as MouseEvent);
        if (!frame) frame = requestAnimationFrame(zoom);
      } else onHint(t().map.zoomHint(mac ? "⌘" : "Ctrl"));
    };
    const onTouch = (e: TouchEvent) => { if (e.touches.length === 1) onHint(t().map.touchHint); };
    el.addEventListener("wheel", onWheel, { passive: false });
    if (L.Browser.mobile) el.addEventListener("touchmove", onTouch, { passive: true });
    return () => { el.removeEventListener("wheel", onWheel); el.removeEventListener("touchmove", onTouch); cancelAnimationFrame(frame); };
  }, [map, onHint]);
  return null;
}

/** The number of each Arrondissement, written on the map where its shape is wide enough to hold it. */
function ArrLabels({ bounds }: { bounds: GeoFeatureCollection }) {
  const map = useMap();
  useEffect(() => {
    const items = ((bounds.features ?? []) as unknown as GeoJSON.Feature[])
      .filter((f) => (f.properties as MapFeature).id === undefined)
      .map((f) => {
        const b = L.geoJSON(f as never).getBounds();
        const t = L.tooltip({ permanent: true, direction: "center", className: "map-label", interactive: false })
          .setLatLng(b.getCenter()).setContent(arrLabel((f.properties as MapFeature).arr as number));
        return { t, b };
      });
    const fit = () => {
      for (const { t, b } of items) {
        const w = map.latLngToLayerPoint(b.getNorthEast()).x - map.latLngToLayerPoint(b.getSouthWest()).x;
        if (w >= 34) { if (!map.hasLayer(t)) t.addTo(map); } else t.remove();
      }
    };
    fit();
    map.on("zoomend", fit);
    return () => { map.off("zoomend", fit); items.forEach(({ t }) => t.remove()); };
  }, [bounds, map]);
  return null;
}

function FlyTo({ feature }: { feature: object | null }) {
  const map = useMap();
  const first = useRef(true);
  useEffect(() => {
    const still = reduceMotion();
    if (feature) { const b = L.geoJSON(feature as never).getBounds(); if (still) map.fitBounds(b, { padding: [30, 30], maxZoom: 15, animate: false }); else map.flyToBounds(b, { padding: [30, 30], duration: 0.8, maxZoom: 15 }); }
    else if (!first.current) { if (still) map.setView(HOME.center, HOME.zoom, { animate: false }); else map.flyTo(HOME.center, HOME.zoom, { duration: 0.8 }); }
    first.current = false;
  }, [feature, map]);
  return null;
}

/**
 * The GeoJSON layer is created once per (level, theme, interactivity); colour and
 * selection changes only call setStyle, so animation ticks never rebuild the map.
 */
export function SalesMap({ level, bounds, isDark, fillFor, tooltipFor, stateOf, onSelect, styleKey, dots, pointScale, dotName, onSelectDot, focusFeature, outlineOnly, labels = false }: {
  level: "arr" | "quartier"; bounds?: GeoFeatureCollection; isDark: boolean; labels?: boolean;
  fillFor: (id: string) => string | null; tooltipFor: (id: string, p: MapFeature) => string;
  stateOf: (p: MapFeature) => { selected: boolean; focus: boolean }; onSelect: (p: MapFeature) => void; styleKey: string;
  dots?: SaleDot[]; pointScale: (v: number) => string; dotName: (d: SaleDot) => string; onSelectDot: (d: SaleDot) => void; focusFeature: object | null; outlineOnly: boolean;
}) {
  const geoRef = useRef<L.GeoJSON | null>(null);
  const fillRef = useRef(fillFor); fillRef.current = fillFor;
  const tipRef = useRef(tooltipFor); tipRef.current = tooltipFor;
  const stateRef = useRef(stateOf); stateRef.current = stateOf;
  const onSelRef = useRef(onSelect); onSelRef.current = onSelect;
  const dotNameRef = useRef(dotName); dotNameRef.current = dotName;
  const onDotRef = useRef(onSelectDot); onDotRef.current = onSelectDot;
  const c = useChartColors(isDark);
  const line = c.ink;
  const edge = c.paper;

  const styleFn = (f?: GeoJSON.Feature) => {
    const p = (f?.properties ?? {}) as MapFeature;
    const { selected, focus } = stateRef.current(p);
    if (outlineOnly) return { color: line, weight: selected ? 2.5 : 0.8, fillOpacity: 0, opacity: 0.55 };
    const fill = fillRef.current(featureId(p));
    return {
      fillColor: fill ?? c.nodata,
      fillOpacity: fill ? (focus ? 0.82 : 0.3) : 0.35,
      color: selected ? line : edge,
      weight: selected ? 2.8 : 0.8,
    };
  };
  const styleRef = useRef(styleFn); styleRef.current = styleFn;
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Each tick of a page scroll over the map asks for the hint, so only the first one while it shows sets state.
  const hintOn = useRef(false);
  const showHint = useRef((text: string) => {
    if (hintOn.current) return;
    hintOn.current = true;
    setHint(text);
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => { hintOn.current = false; setHint(null); }, 1600);
  }).current;
  useEffect(() => () => clearTimeout(hintTimer.current), []);

  useEffect(() => {
    const g = geoRef.current;
    if (!g) return;
    g.setStyle((f) => styleRef.current(f));
    // Dots and boundaries share one canvas, and the top shape takes the mouse. Dots stay on top so they keep their tooltips.
    if (outlineOnly) { g.bringToBack(); return; }
    g.eachLayer((l) => {
      const p = ((l as L.GeoJSON).feature as GeoJSON.Feature | undefined)?.properties as MapFeature | undefined;
      if (p && stateRef.current(p).selected) (l as L.Path).bringToFront();
    });
  }, [styleKey, bounds, isDark, outlineOnly]);

  return (
    <div className="relative h-full w-full">
    <MapContainer zoomAnimation={!reduceMotion()} fadeAnimation={!reduceMotion()} center={HOME.center} zoom={HOME.zoom} minZoom={9} maxZoom={18} preferCanvas
      scrollWheelZoom={false} dragging={!L.Browser.mobile} className="h-full w-full">
      <AutoResize />
      <GestureGuard onHint={showHint} />
      <TileLayer key={isDark ? "d" : "l"} attribution={t().map.tiles} maxNativeZoom={16}
        url={`https://server.arcgisonline.com/ArcGIS/rest/services/${isDark ? "Canvas/World_Dark_Gray_Base" : "Canvas/World_Light_Gray_Base"}/MapServer/tile/{z}/{y}/{x}`} />
      <FlyTo feature={focusFeature} />
      {bounds && (
        <GeoJSON
          key={`${level}-${isDark}-${outlineOnly}`}
          ref={geoRef}
          data={bounds as never}
          style={(f) => styleRef.current(f)}
          onEachFeature={(f, layer) => {
            const p = f.properties as MapFeature;
            layer.bindTooltip(() => tipRef.current(featureId(p), p), { className: "pt", sticky: true });
            layer.on({
              mouseover: (e) => { const t = e.target as L.Path; t.setStyle({ weight: 3, color: line }); if (!outlineOnly) t.bringToFront(); },
              mouseout: (e) => geoRef.current?.resetStyle(e.target as L.Path),
              click: () => onSelRef.current(p),
            });
          }}
        />
      )}
      {dots && bounds && <PointsLayer dots={dots} scale={pointScale} nameOf={dotNameRef} onSelect={onDotRef} />}
      {labels && bounds && level === "arr" && <ArrLabels bounds={bounds} />}
    </MapContainer>
    {hint && (
      <p className="absolute left-1/2 top-3 -translate-x-1/2 z-[500] px-3 py-1.5 rounded-full bg-foreground/90 text-background text-[13px] whitespace-nowrap pointer-events-none" role="status">{hint}</p>
    )}
    </div>
  );
}

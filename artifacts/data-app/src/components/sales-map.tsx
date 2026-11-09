import { useEffect, useRef, useState, type RefObject } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap, ZoomControl } from "react-leaflet";
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

/** The map container's name, so a screen reader announces a map and not its labels. */
function MapName({ label }: { label: string }) {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", label);
  }, [map, label]);
  return null;
}

/**
 * The number of each Arrondissement, written at the centre of its shape where the shape is wide enough to hold it.
 * The widest shapes go first, and a label that would touch one already written is left out, so "11e" and "20e" never
 * run together. The labels repeat what the tooltips and the ranking say, so screen readers skip them.
 */
function ArrLabels({ bounds }: { bounds: GeoFeatureCollection }) {
  const map = useMap();
  useEffect(() => {
    const items = ((bounds.features ?? []) as unknown as GeoJSON.Feature[])
      .filter((f) => (f.properties as MapFeature).id === undefined)
      .map((f) => {
        const shape = L.geoJSON(f as never).getLayers()[0] as L.Polygon;
        const b = shape.getBounds();
        const text = arrLabel((f.properties as MapFeature).arr as number);
        // The centre of the outer ring's area, which sits inside a long shape such as the 11e, unlike its box's centre.
        const rings = shape.getLatLngs() as L.LatLng[][] | L.LatLng[][][];
        const outer = (Array.isArray(rings[0]![0]) ? (rings as L.LatLng[][][])[0]![0] : (rings as L.LatLng[][])[0])!;
        const at = L.PolyUtil.polygonCenter(outer, map.options.crs ?? L.CRS.EPSG3857);
        const t = L.tooltip({ permanent: true, direction: "center", className: "map-label", interactive: false }).setLatLng(at).setContent(text);
        // About 7.5 px a character at 12 px, and a little room around it.
        return { t, b, at, w: text.length * 7.5 + 6, h: 18 };
      });
    const widthOf = (b: L.LatLngBounds) => map.latLngToLayerPoint(b.getNorthEast()).x - map.latLngToLayerPoint(b.getSouthWest()).x;
    const fit = () => {
      const placed: { x: number; y: number; w: number; h: number }[] = [];
      for (const it of [...items].sort((a, b) => widthOf(b.b) - widthOf(a.b))) {
        const p = map.latLngToLayerPoint(it.at);
        const box = { x: p.x - it.w / 2, y: p.y - it.h / 2, w: it.w, h: it.h };
        const clear = widthOf(it.b) >= 34 && !placed.some((o) => box.x < o.x + o.w && o.x < box.x + box.w && box.y < o.y + o.h && o.y < box.y + box.h);
        if (clear) {
          placed.push(box);
          if (!map.hasLayer(it.t)) { it.t.addTo(map); it.t.getElement()?.setAttribute("aria-hidden", "true"); }
        } else it.t.remove();
      }
    };
    fit();
    map.on("zoomend", fit);
    return () => { map.off("zoomend", fit); items.forEach(({ t }) => t.remove()); };
  }, [bounds, map]);
  return null;
}

// Notre-Dame, the centre of Paris.
const PARIS_CENTRE = L.latLng(48.853, 2.349);

/**
 * Frames the focused Area with its surroundings, so a Visitor can still place it in Paris: a small Area stops at zoom
 * 13, where a Quartier shows with the centre of Paris around it, and the frame of a Commune (`wide`) reaches to the
 * centre of Paris.
 */
function FlyTo({ feature, wide }: { feature: object | null; wide: boolean }) {
  const map = useMap();
  const first = useRef(true);
  useEffect(() => {
    const still = reduceMotion();
    if (feature) {
      const b = L.geoJSON(feature as never).getBounds();
      if (wide) b.extend(PARIS_CENTRE);
      if (still) map.fitBounds(b, { padding: [30, 30], maxZoom: 13, animate: false }); else map.flyToBounds(b, { padding: [30, 30], duration: 0.8, maxZoom: 13 });
    }
    else if (!first.current) { if (still) map.setView(HOME.center, HOME.zoom, { animate: false }); else map.flyTo(HOME.center, HOME.zoom, { duration: 0.8 }); }
    first.current = false;
  }, [feature, map]);
  return null;
}

/**
 * The GeoJSON layer is created once per (level, theme, interactivity); colour and
 * selection changes only call setStyle, so animation ticks never rebuild the map.
 */
export function SalesMap({ level, bounds, isDark, fillFor, tooltipFor, stateOf, onSelect, styleKey, dots, pointScale, dotName, onSelectDot, focusFeature, focusWide, outline, outlineOnly, labels = false }: {
  level: "arr" | "quartier"; bounds?: GeoFeatureCollection; isDark: boolean; labels?: boolean;
  /** `focusWide`: frame the focused Area together with the centre of Paris (a Commune). `outline`: a shape the drawn level does not hold, such as a Quartier on the Arrondissement map. */
  focusWide: boolean; outline: object | null;
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
      scrollWheelZoom={false} dragging={!L.Browser.mobile} zoomControl={false} className="h-full w-full">
      {/* Leaflet's own zoom buttons, with their titles in the page's language. */}
      <ZoomControl position="topleft" zoomInTitle={t().map.zoomIn} zoomOutTitle={t().map.zoomOut} />
      <AutoResize />
      <GestureGuard onHint={showHint} />
      <TileLayer key={isDark ? "d" : "l"} attribution={t().map.tiles} maxNativeZoom={16}
        url={`https://server.arcgisonline.com/ArcGIS/rest/services/${isDark ? "Canvas/World_Dark_Gray_Base" : "Canvas/World_Light_Gray_Base"}/MapServer/tile/{z}/{y}/{x}`} />
      <MapName label={t().map.label} />
      <FlyTo feature={focusFeature} wide={focusWide} />
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
      {outline && <GeoJSON key={JSON.stringify((outline as { properties?: unknown }).properties)} data={outline as never} interactive={false}
        style={{ color: line, weight: 2.5, fill: false, dashArray: "6 4" }} />}
      {dots && bounds && <PointsLayer dots={dots} scale={pointScale} nameOf={dotNameRef} onSelect={onDotRef} />}
      {labels && bounds && level === "arr" && <ArrLabels bounds={bounds} />}
    </MapContainer>
    {hint && (
      <p className="absolute left-1/2 top-3 -translate-x-1/2 z-[500] px-3 py-1.5 rounded-full bg-foreground/90 text-background text-[13px] whitespace-nowrap pointer-events-none" role="status">{hint}</p>
    )}
    </div>
  );
}

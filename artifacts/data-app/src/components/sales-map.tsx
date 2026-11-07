import { useEffect, useRef, type RefObject } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { GeoFeatureCollection } from "@workspace/api-client-react";
import { dotTooltip, type SaleDot } from "@/lib/dots";
import { featureId, type MapFeature } from "@/lib/areas";
import { useChartColors } from "@/components/ui-bits";

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
export function SalesMap({ level, bounds, isDark, fillFor, tooltipFor, stateOf, onSelect, styleKey, dots, pointScale, dotName, onSelectDot, focusFeature, outlineOnly }: {
  level: "arr" | "quartier"; bounds?: GeoFeatureCollection; isDark: boolean;
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
    <MapContainer zoomAnimation={!reduceMotion()} fadeAnimation={!reduceMotion()} center={HOME.center} zoom={HOME.zoom} minZoom={9} maxZoom={18} preferCanvas scrollWheelZoom className="h-full w-full">
      <TileLayer key={isDark ? "d" : "l"} attribution="Tiles &copy; Esri" maxNativeZoom={16}
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
    </MapContainer>
  );
}

import { useEffect, useRef, type RefObject } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { SalePoint, GeoFeatureCollection } from "@workspace/api-client-react";
import { eur, sqm, num } from "@/lib/fmt";
import { featureId, type MapFeature } from "@/lib/areas";
import { useChartColors } from "@/components/ui-bits";

const reduceMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Far enough out to frame Paris and the nearby Communes; Fontainebleau and Meaux need a zoom out.
const HOME = { center: [48.85, 2.38] as [number, number], zoom: 11 };

function PointsLayer({ points, scale, boundaries, stateOf }: { points: SalePoint[]; scale: (v: number) => string; boundaries: RefObject<L.GeoJSON | null>; stateOf: RefObject<(p: MapFeature) => { selected: boolean; focus: boolean }> }) {
  const map = useMap();
  useEffect(() => {
    const group = L.layerGroup();
    for (const p of points) {
      const m = L.circleMarker([p.lat, p.lon], { radius: 3, weight: 0, fillOpacity: 0.78, fillColor: scale(p.pricePerSqm) });
      m.bindTooltip(
        () => `<div class="pt-title">${p.address}</div><div class="pt-sub">${p.areaName}</div><div>${p.type === "Maison" ? "House" : "Apartment"} of ${num(p.surface)} m², sold on ${p.date.slice(0, 10)}</div><div class="pt-num">${eur(p.price)}, <b>${sqm(p.pricePerSqm)}</b></div>`,
        { className: "pt", sticky: true }
      );
      // The dot takes the click, so pass it to the boundary under the dot's centre. Leaflet gives a marker event the
      // marker's own `layerPoint`, not the pointer's, so the hit test uses that centre. `_containsPoint` is Leaflet's private hit test.
      // A dot only selects: a click on a dot inside the selected Area must not click the Area off.
      m.on("click", (e) => {
        const hit = (boundaries.current?.getLayers() as (L.GeoJSON & { _containsPoint(p: L.Point): boolean })[] | undefined)?.find((l) => l._containsPoint(e.layerPoint));
        const props = (hit?.feature as GeoJSON.Feature | undefined)?.properties as MapFeature | undefined;
        if (hit && props && !stateOf.current(props).selected) hit.fire("click");
      });
      group.addLayer(m);
    }
    group.addTo(map);
    return () => { group.remove(); };
  }, [points, scale, map, boundaries, stateOf]);
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
export function SalesMap({ level, bounds, isDark, fillFor, tooltipFor, stateOf, onSelect, styleKey, points, pointScale, focusFeature, outlineOnly }: {
  level: "arr" | "quartier"; bounds?: GeoFeatureCollection; isDark: boolean;
  fillFor: (id: string) => string | null; tooltipFor: (id: string, p: MapFeature) => string;
  stateOf: (p: MapFeature) => { selected: boolean; focus: boolean }; onSelect: (p: MapFeature) => void; styleKey: string;
  points?: SalePoint[]; pointScale: (v: number) => string; focusFeature: object | null; outlineOnly: boolean;
}) {
  const geoRef = useRef<L.GeoJSON | null>(null);
  const fillRef = useRef(fillFor); fillRef.current = fillFor;
  const tipRef = useRef(tooltipFor); tipRef.current = tooltipFor;
  const stateRef = useRef(stateOf); stateRef.current = stateOf;
  const onSelRef = useRef(onSelect); onSelRef.current = onSelect;
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
      {points && bounds && <PointsLayer points={points} scale={pointScale} boundaries={geoRef} stateOf={stateRef} />}
    </MapContainer>
  );
}

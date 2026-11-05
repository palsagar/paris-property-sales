import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { SalePoint, GeoFeatureCollection } from "@workspace/api-client-react";
import { eur, sqm, num, arrLabel } from "@/lib/fmt";
import { useChartColors } from "@/components/ui-bits";

const reduceMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export type FeatureProps = { arr: number; id?: string; name: string };

function PointsLayer({ points, scale }: { points: SalePoint[]; scale: (v: number) => string }) {
  const map = useMap();
  useEffect(() => {
    const renderer = L.canvas({ padding: 0.5 });
    const group = L.layerGroup();
    for (const p of points) {
      const m = L.circleMarker([p.lat, p.lon], { renderer, radius: 3, weight: 0, fillOpacity: 0.78, fillColor: scale(p.pricePerSqm) });
      m.bindTooltip(
        () => `<div class="pt-title">${p.address}</div><div class="pt-sub">${arrLabel(p.arrondissement)} arrondissement</div><div>${p.type === "Maison" ? "House" : "Apartment"} of ${num(p.surface)} m², sold on ${p.date.slice(0, 10)}</div><div class="pt-num">${eur(p.price)}, <b>${sqm(p.pricePerSqm)}</b></div>`,
        { className: "pt", sticky: true }
      );
      group.addLayer(m);
    }
    group.addTo(map);
    return () => { group.remove(); };
  }, [points, scale, map]);
  return null;
}

function FlyTo({ feature }: { feature: object | null }) {
  const map = useMap();
  const first = useRef(true);
  useEffect(() => {
    const still = reduceMotion();
    if (feature) { const b = L.geoJSON(feature as never).getBounds(); if (still) map.fitBounds(b, { padding: [30, 30], maxZoom: 15, animate: false }); else map.flyToBounds(b, { padding: [30, 30], duration: 0.8, maxZoom: 15 }); }
    else if (!first.current) { if (still) map.setView([48.8566, 2.3422], 12, { animate: false }); else map.flyTo([48.8566, 2.3422], 12, { duration: 0.8 }); }
    first.current = false;
  }, [feature, map]);
  return null;
}

/**
 * The GeoJSON layer is created once per (level, theme, interactivity); colour and
 * selection changes only call setStyle, so animation ticks never rebuild the map.
 */
export function SalesMap({ level, bounds, isDark, fillFor, tooltipFor, selArr, selQ, onSelect, styleKey, points, pointScale, focusFeature, outlineOnly }: {
  level: "arr" | "quartier"; bounds?: GeoFeatureCollection; isDark: boolean;
  fillFor: (id: string) => string | null; tooltipFor: (id: string, p: FeatureProps) => string;
  selArr?: number; selQ?: string; onSelect: (p: FeatureProps) => void; styleKey: string;
  points?: SalePoint[]; pointScale: (v: number) => string; focusFeature: object | null; outlineOnly: boolean;
}) {
  const geoRef = useRef<L.GeoJSON | null>(null);
  const fillRef = useRef(fillFor); fillRef.current = fillFor;
  const tipRef = useRef(tooltipFor); tipRef.current = tooltipFor;
  const selRef = useRef({ selArr, selQ }); selRef.current = { selArr, selQ };
  const onSelRef = useRef(onSelect); onSelRef.current = onSelect;
  const c = useChartColors(isDark);
  const line = c.ink;
  const edge = c.paper;
  const idOf = (p: FeatureProps) => (level === "quartier" ? String(p.id) : String(p.arr));

  const styleFn = (f?: GeoJSON.Feature) => {
    const p = (f?.properties ?? {}) as FeatureProps;
    const { selArr: sa, selQ: sq } = selRef.current;
    const isSel = level === "quartier" ? (sq ? p.id === sq : sa === p.arr) : sa === p.arr && !sq ? true : sq ? false : false;
    const inFocus = !sa && !sq ? true : level === "quartier" ? (sq ? p.id === sq : p.arr === sa) : p.arr === sa;
    if (outlineOnly) return { color: line, weight: isSel || (sa === p.arr) ? 2.5 : 0.8, fillOpacity: 0, opacity: 0.55 };
    const fill = fillRef.current(idOf(p));
    return {
      fillColor: fill ?? c.nodata,
      fillOpacity: fill ? (inFocus ? 0.82 : 0.3) : 0.35,
      color: isSel || (level === "quartier" && sa === p.arr && !sq) ? line : edge,
      weight: isSel ? 2.8 : level === "quartier" && sa === p.arr && !sq ? 1.6 : 0.8,
    };
  };
  const styleRef = useRef(styleFn); styleRef.current = styleFn;

  useEffect(() => {
    const g = geoRef.current;
    if (!g) return;
    g.setStyle((f) => styleRef.current(f));
    g.eachLayer((l) => {
      const p = ((l as L.GeoJSON).feature as GeoJSON.Feature | undefined)?.properties as FeatureProps | undefined;
      if (p && ((selQ && p.id === selQ) || (!selQ && selArr === p.arr))) (l as L.Path).bringToFront();
    });
  }, [styleKey, selArr, selQ]);

  return (
    <MapContainer zoomAnimation={!reduceMotion()} fadeAnimation={!reduceMotion()} center={[48.8566, 2.3422]} zoom={12} minZoom={11} maxZoom={18} preferCanvas scrollWheelZoom className="h-full w-full">
      <TileLayer key={isDark ? "d" : "l"} attribution="Tiles &copy; Esri" maxNativeZoom={16}
        url={`https://server.arcgisonline.com/ArcGIS/rest/services/${isDark ? "Canvas/World_Dark_Gray_Base" : "Canvas/World_Light_Gray_Base"}/MapServer/tile/{z}/{y}/{x}`} />
      <FlyTo feature={focusFeature} />
      {bounds && (
        <GeoJSON
          key={`${level}-${isDark}-${outlineOnly}`}
          ref={geoRef}
          data={bounds as never}
          interactive={!outlineOnly}
          style={(f) => styleRef.current(f)}
          onEachFeature={(f, layer) => {
            const p = f.properties as FeatureProps;
            if (outlineOnly) return;
            layer.bindTooltip(() => tipRef.current(idOf(p), p), { className: "pt", sticky: true });
            layer.on({
              mouseover: (e) => { const t = e.target as L.Path; t.setStyle({ weight: 3, color: line }); t.bringToFront(); },
              mouseout: (e) => geoRef.current?.resetStyle(e.target as L.Path),
              click: () => onSelRef.current(p),
            });
          }}
        />
      )}
      {points && <PointsLayer points={points} scale={pointScale} />}
    </MapContainer>
  );
}

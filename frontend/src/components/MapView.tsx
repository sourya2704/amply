import { useEffect } from "react";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents, ZoomControl } from "react-leaflet";
import { Link } from "react-router-dom";
import { availabilityStyle, formatINR } from "../lib/format";
import type { ChargerSummary } from "../lib/types";

/** Centres the map on a point; padLeft keeps it visible to the right of a floating panel. */
function Recenter({ lat, lng, padLeft = 0 }: { lat: number; lng: number; padLeft?: number }) {
  const map = useMap();
  useEffect(() => {
    const zoom = map.getZoom();
    const offset = window.innerWidth >= 1024 ? padLeft / 2 : 0;
    const point = map.project([lat, lng], zoom).subtract([offset, 0]);
    map.setView(map.unproject(point, zoom), zoom, { animate: true });
  }, [lat, lng, padLeft, map]);
  return null;
}

function FitRoute({ route }: { route: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (route.length > 1) map.fitBounds(route, { padding: [30, 30] });
  }, [route, map]);
  return null;
}

function ClickToPick({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

export function MapView({
  center,
  chargers = [],
  highlight,
  onPick,
  picked,
  zoom = 14,
  className = "h-full w-full",
  route,
  padLeft = 0,
}: {
  center: { lat: number; lng: number };
  chargers?: ChargerSummary[];
  highlight?: string | null;
  onPick?: (lat: number, lng: number) => void;
  picked?: { lat: number; lng: number } | null;
  zoom?: number;
  className?: string;
  route?: [number, number][];
  padLeft?: number;
}) {
  return (
    <MapContainer center={[center.lat, center.lng]} zoom={zoom} className={className} scrollWheelZoom zoomControl={false}>
      <ZoomControl position="topright" />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {route && route.length > 1 ? (
        <>
          <FitRoute route={route} />
          <Polyline positions={route} pathOptions={{ color: "#111111", weight: 5, opacity: 0.85 }} />
          <CircleMarker center={route[route.length - 1]} radius={8} pathOptions={{ color: "#111111", fillColor: "#FFA3CF", fillOpacity: 1, weight: 3 }}>
            <Tooltip>Destination</Tooltip>
          </CircleMarker>
        </>
      ) : (
        <Recenter lat={center.lat} lng={center.lng} padLeft={padLeft} />
      )}
      {onPick && <ClickToPick onPick={onPick} />}
      {!onPick && (
        <CircleMarker center={[center.lat, center.lng]} radius={7} pathOptions={{ color: "#ffffff", fillColor: "#111111", fillOpacity: 1, weight: 3 }}>
          <Tooltip>Search centre</Tooltip>
        </CircleMarker>
      )}
      {picked && (
        <CircleMarker center={[picked.lat, picked.lng]} radius={10} pathOptions={{ color: "#111111", fillColor: "#FFA3CF", fillOpacity: 1, weight: 3 }}>
          <Tooltip permanent direction="top">Charger location</Tooltip>
        </CircleMarker>
      )}
      {chargers.map((c) => {
        const color = availabilityStyle[c.availability.source].pin;
        const hot = highlight === c.id;
        return (
          <CircleMarker
            key={c.id}
            center={[c.lat, c.lng]}
            radius={hot ? 13 : 9}
            pathOptions={{ color: hot ? "#111111" : "#ffffff", weight: hot ? 3 : 2, opacity: 1, fillColor: color, fillOpacity: c.bookable ? 1 : 0.55 }}
          >
            <Popup>
              <div className="min-w-44 font-sans">
                <div className="font-semibold text-ink">{c.name}</div>
                <div className="text-xs text-muted">
                  {c.connector} · {c.mode} · {c.power_kw} kW · {formatINR(c.price_per_kwh_paise)}/kWh
                </div>
                <div className="mt-1 text-xs">{c.availability.label}</div>
                <Link to={`/chargers/${c.id}`} className="mt-2 inline-block text-xs font-semibold text-primary-ink">
                  View charger →
                </Link>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}

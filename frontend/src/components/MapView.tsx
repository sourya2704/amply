import { useEffect } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { Link } from "react-router-dom";
import { availabilityStyle, formatINR } from "../lib/format";
import type { ChargerSummary } from "../lib/types";

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom(), { animate: true });
  }, [lat, lng, map]);
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
}: {
  center: { lat: number; lng: number };
  chargers?: ChargerSummary[];
  highlight?: string | null;
  onPick?: (lat: number, lng: number) => void;
  picked?: { lat: number; lng: number } | null;
  zoom?: number;
  className?: string;
}) {
  return (
    <MapContainer center={[center.lat, center.lng]} zoom={zoom} className={className} scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Recenter lat={center.lat} lng={center.lng} />
      {onPick && <ClickToPick onPick={onPick} />}
      {!onPick && (
        <CircleMarker center={[center.lat, center.lng]} radius={7} pathOptions={{ color: "#101B3D", fillColor: "#C8F169", fillOpacity: 1, weight: 3 }}>
          <Tooltip>Search centre</Tooltip>
        </CircleMarker>
      )}
      {picked && (
        <CircleMarker center={[picked.lat, picked.lng]} radius={10} pathOptions={{ color: "#101B3D", fillColor: "#315CFF", fillOpacity: 0.9, weight: 3 }}>
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
            pathOptions={{ color: "#fff", weight: 2, fillColor: color, fillOpacity: c.bookable ? 0.95 : 0.55 }}
          >
            <Popup>
              <div className="min-w-44 font-sans">
                <div className="font-semibold text-navy">{c.name}</div>
                <div className="text-xs text-slate-500">
                  {c.connector} · {c.mode} · {c.power_kw} kW · {formatINR(c.price_per_kwh_paise)}/kWh
                </div>
                <div className="mt-1 text-xs">{c.availability.label}</div>
                <Link to={`/chargers/${c.id}`} className="mt-2 inline-block text-xs font-semibold text-brand">
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

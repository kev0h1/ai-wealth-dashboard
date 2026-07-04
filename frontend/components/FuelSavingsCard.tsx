"use client";

import { useState, useEffect, useRef } from "react";
import { Fuel, ChevronDown, MapPin } from "lucide-react";
import { api, FuelNearby } from "@/lib/api";

const FUEL_GRADES: { key: string; short: string }[] = [
  { key: "E10",         short: "Petrol"  },
  { key: "E5",          short: "Petrol+" },
  { key: "B7_STANDARD", short: "Diesel"  },
  { key: "B7_PREMIUM",  short: "Diesel+" },
];

export default function FuelSavingsCard() {
  const [grade, setGrade] = useState("E10");
  const [result, setResult] = useState<FuelNearby | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsLocation, setNeedsLocation] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const triedGeo = useRef(false);
  const reqId = useRef(0);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getDeviceLocation(g: string, auto = false) {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setNeedsLocation(true);
      return;
    }
    const request = () =>
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setCoords(c);
          run({ coords: c, grade: g });
        },
        () => setNeedsLocation(true),
        { enableHighAccuracy: false, timeout: 10000 },
      );
    if (auto && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: "geolocation" as PermissionName })
        .then((p) => (p.state === "granted" ? request() : setNeedsLocation(true)))
        .catch(() => setNeedsLocation(true));
    } else {
      request();
    }
  }

  async function run(opts?: { coords?: { lat: number; lng: number }; grade?: string }) {
    const g = opts?.grade ?? grade;
    const c = opts?.coords ?? coords;
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api.fuelNearby({ grade: g, lat: c?.lat, lng: c?.lng });
      if (id !== reqId.current) return;
      setResult(res);
      setNeedsLocation(false);
    } catch (e) {
      if (id !== reqId.current) return;
      const msg = e instanceof Error ? e.message : "";
      if (msg.startsWith("422")) {
        if (!triedGeo.current) {
          triedGeo.current = true;
          getDeviceLocation(g, true);
        } else {
          setNeedsLocation(true);
        }
      } else {
        setError("Couldn't load fuel prices. Try again shortly.");
      }
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }

  function selectGrade(g: string) {
    setGrade(g);
    run({ grade: g });
  }

  const stations = result && result.count > 0 ? result : null;
  const cheapest = stations ? stations.stations[0] : null;
  const preview = stations
    ? `Cheapest ${stations.grade_label.toLowerCase()} nearby: ${stations.cheapest_ppl}p/l${cheapest?.distance_km != null ? ` · ${cheapest.distance_km}km` : ""}`
    : null;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 text-left"
      >
        <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0">
          <Fuel size={16} className="text-amber-600 dark:text-amber-300" />
        </div>
        <p className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 flex-1">Fuel prices nearby</p>
        <ChevronDown
          size={18}
          className={`text-slate-400 flex-shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {!expanded ? (
        <div
          className={`flex items-center gap-2 mt-2 px-3 py-2 rounded-xl ${
            preview ? "bg-amber-50 dark:bg-amber-900/30" : "bg-slate-50 dark:bg-slate-900/60"
          }`}
        >
          {preview ? (
            <>
              <Fuel size={15} className="text-amber-600 dark:text-amber-300 flex-shrink-0" />
              <span className="text-[12px] font-medium text-amber-800 dark:text-amber-200 flex-1 min-w-0">{preview}</span>
            </>
          ) : (
            <span className="text-[12px] font-medium text-slate-500 dark:text-slate-400 flex-1">
              {loading ? "Finding cheaper fuel near you…" : needsLocation ? "Add your location to find cheaper fuel nearby" : "Find cheaper fuel near you"}
            </span>
          )}
        </div>
      ) : (
        <>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-3 mb-4 leading-relaxed">
            Pick your fuel type and we&apos;ll find the cheapest stations near you.
          </p>

          <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 dark:bg-slate-900 p-1 mb-3">
            {FUEL_GRADES.map((g) => (
              <button
                key={g.key}
                onClick={() => selectGrade(g.key)}
                className={`py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
                  grade === g.key ? "bg-amber-500 text-white shadow-sm" : "text-slate-500 dark:text-slate-400"
                }`}
              >
                {g.short}
              </button>
            ))}
          </div>

          {loading && !stations && <p className="text-xs text-slate-400 mb-2">Finding cheaper fuel nearby…</p>}
          {error && <p className="text-xs text-rose-500 mb-2">{error}</p>}

          {needsLocation && !stations && (
            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 p-3 text-center">
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">We need your location to find nearby stations.</p>
              <button
                onClick={() => getDeviceLocation(grade)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 text-white text-[13px] font-semibold active:scale-95"
              >
                <MapPin size={14} /> Use my current location
              </button>
            </div>
          )}

          {result && result.count === 0 && !loading && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No {result.grade_label.toLowerCase()} stations within {result.radius_km} km.
            </p>
          )}

          {stations && (
            <>
              <p className="text-[13px] text-slate-600 dark:text-slate-300 mb-3">
                Cheapest {stations.grade_label.toLowerCase()} nearby is{" "}
                <span className="font-bold">{stations.cheapest_ppl}p/l</span>.
              </p>
              <ul className={`space-y-1.5 transition-opacity ${loading ? "opacity-50" : ""}`}>
                {stations.stations.map((s, i) => (
                  <li key={s.node_id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-slate-800 dark:text-slate-200 truncate">
                        {s.brand || s.name || "Station"}
                        {i === 0 && <span className="ml-1.5 text-[10px] font-semibold text-amber-600">CHEAPEST</span>}
                      </p>
                      <p className="text-[11px] text-slate-400">{s.distance_km} km · {s.postcode || s.city}</p>
                    </div>
                    <span className="text-[13px] font-bold text-slate-900 dark:text-slate-100 flex-shrink-0">{s.ppl}p</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

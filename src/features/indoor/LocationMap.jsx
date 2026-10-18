import React, { useMemo, useState } from "react";
import { buildPlanIndex, roomsOfCode } from "./planIndex";
import { floorName, screenBounds, spacePath, spaceTitle } from "./geometry";
import { useIndoorStore } from "./indoorStore";

/**
 * Where an asset is: the floor it sits on, drawn small, with the room(s) of its 存置地點 marked.  Used inside the expanded
 * row of 財物查詢; `onShowOnPlan` opens the full plan on that room.
 */
export function LocationMap({ locationCode, locationName, onShowOnPlan }) {
  const { loading, error, data } = useIndoorStore();
  const index = useMemo(() => (data ? buildPlanIndex(data, null) : null), [data]);
  const places = useMemo(() => (index ? roomsOfCode(index, locationCode) : []), [index, locationCode]);
  const floors = useMemo(() => [...new Map(places.map((item) => [item.floor.id, item.floor])).values()], [places]);
  const [pickedFloor, setPickedFloor] = useState(null);
  if (!locationCode) return null;
  if (loading) return <p className="location-map-note">正在讀取平面圖…</p>;
  if (error || !index) return <p className="location-map-note">暫時無法讀取平面圖。</p>;
  if (!places.length) return <p className="location-map-note">「{locationName || locationCode}」尚未對應到平面圖上的房間。</p>;

  const floor = floors.find((item) => item.id === pickedFloor) || floors[0];
  const here = new Set(places.filter((item) => item.floor.id === floor.id).map((item) => item.space.id));
  const spaces = (index.spacesByFloor.get(floor.id) || []).filter((space) => space.space_type !== "void");
  const [x0, y0, x1, y1] = screenBounds(spaces, "flat");
  const margin = Math.max(x1 - x0, y1 - y0) * 0.04;
  const names = places.filter((item) => item.floor.id === floor.id).map((item) => spaceTitle(item.space));
  return (
    <figure className="location-map">
      <svg aria-label={`${floorName(floor)}的位置`} preserveAspectRatio="xMidYMid meet" role="img" viewBox={`${x0 - margin} ${y0 - margin} ${x1 - x0 + 2 * margin} ${y1 - y0 + 2 * margin}`}>
        {spaces.map((space) => <path className={`location-map-room is-${space.space_type} ${here.has(space.id) ? "is-here" : ""}`} d={spacePath(space, "flat")} fillRule="evenodd" key={space.id} />)}
      </svg>
      <figcaption>
        <strong>{floorName(floor)}</strong>
        <span>{names.slice(0, 2).join("、")}{names.length > 2 ? ` 等 ${names.length} 間` : ""}{places.length > 1 && names.length === places.length ? "（共用代碼）" : ""}</span>
        {floors.length > 1 && <span className="location-map-floors">{floors.map((item) => <button aria-pressed={item.id === floor.id} key={item.id} onClick={() => setPickedFloor(item.id)} type="button">{item.label}</button>)}</span>}
        <button className="row-action" onClick={() => onShowOnPlan?.()} type="button">在平面圖查看</button>
      </figcaption>
    </figure>
  );
}

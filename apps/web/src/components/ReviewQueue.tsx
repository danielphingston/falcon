/**
 * The To review list in my order (build brief v2 A7): drag a row by its
 * handle to reorder; the order is saved on the workpapers (reviewOrder), so
 * it survives a restart and follows to other devices. Default: by due date.
 */
import { Reorder, useDragControls } from "motion/react";
import { useEffect, useState } from "react";
import { update, type WorkPaper } from "@falcon/core";
import { act } from "../lib/act";
import { WorkpaperRow, type Lookups } from "./rows";

export function ReviewQueue({ wps, rereview, l, openPoints }: { wps: WorkPaper[]; rereview: Set<string>; l: Lookups; openPoints: (id: string) => number }) {
  const [order, setOrder] = useState(wps.map((w) => w.id));
  // Follow the data when the list itself changes (added, removed, reordered elsewhere).
  const key = wps.map((w) => w.id).join(",");
  useEffect(() => setOrder(key ? key.split(",") : []), [key]);
  const byId = new Map(wps.map((w) => [w.id, w]));

  const save = () => {
    const changed = order.filter((id, i) => byId.get(id)?.reviewOrder !== i);
    if (!changed.length) return;
    void act(null, async (ctx) => {
      for (const [i, id] of order.entries()) if (byId.get(id)?.reviewOrder !== i) await update(ctx, "workpapers", id, { reviewOrder: i });
    });
  };

  return (
    <Reorder.Group axis="y" values={order} onReorder={setOrder} className="card divide-y divide-[var(--border)] overflow-hidden">
      {order.map((id) => {
        const wp = byId.get(id);
        return wp ? <Row key={id} wp={wp} l={l} openPoints={openPoints(id)} rereview={rereview.has(id)} onDrop={save} /> : null;
      })}
    </Reorder.Group>
  );
}

function Row({ wp, l, openPoints, rereview, onDrop }: { wp: WorkPaper; l: Lookups; openPoints: number; rereview: boolean; onDrop: () => void }) {
  const controls = useDragControls();
  return (
    <Reorder.Item value={wp.id} dragListener={false} dragControls={controls} onDragEnd={onDrop} className="relative flex items-center bg-[var(--surface)]">
      <button
        className="cursor-grab touch-none select-none px-2 py-3 text-lg leading-none muted active:cursor-grabbing"
        aria-label={`Drag to reorder ${wp.ref}`}
        onPointerDown={(e) => controls.start(e)}
      >
        ⋮⋮
      </button>
      <div className="min-w-0 flex-1">
        <WorkpaperRow wp={wp} l={l} openPoints={openPoints} rereview={rereview} />
      </div>
    </Reorder.Item>
  );
}

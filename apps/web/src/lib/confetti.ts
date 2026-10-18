import confetti from "canvas-confetti";
import type { Celebration } from "@fdd/core";
import { getSettings } from "../db";

// Remember where the user last tapped, so bursts come from the checkbox they hit.
let lastPointer = { x: 0.5, y: 0.6 };
if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    (e) => (lastPointer = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight }),
    { capture: true, passive: true },
  );
}

const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#06b6d4"];

async function allowed() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  return (await getSettings()).confetti;
}

export type BigCelebration = Celebration | "day_cleared";

export async function celebrate(kind: BigCelebration) {
  if (!(await allowed())) return;
  const origin = lastPointer;
  switch (kind) {
    case "small":
      confetti({ particleCount: 40, spread: 55, startVelocity: 28, scalar: 0.8, ticks: 120, origin, colors: COLORS });
      break;
    case "medium":
      confetti({ particleCount: 90, spread: 80, startVelocity: 38, origin, colors: COLORS });
      break;
    case "irl_complete":
      confetti({ particleCount: 140, spread: 100, startVelocity: 45, origin: { x: 0.5, y: 0.7 }, colors: COLORS });
      setTimeout(() => confetti({ particleCount: 80, spread: 120, origin: { x: 0.5, y: 0.6 }, colors: COLORS }), 250);
      break;
    case "day_cleared": {
      const end = Date.now() + 1600;
      (function frame() {
        confetti({ particleCount: 4, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors: COLORS });
        confetti({ particleCount: 4, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors: COLORS });
        if (Date.now() < end) requestAnimationFrame(frame);
      })();
      break;
    }
    case "engagement_closed": {
      // Fireworks: a few bursts at random points.
      for (let i = 0; i < 6; i++)
        setTimeout(
          () =>
            confetti({
              particleCount: 70,
              spread: 360,
              startVelocity: 30,
              ticks: 90,
              gravity: 0.8,
              origin: { x: 0.2 + Math.random() * 0.6, y: 0.2 + Math.random() * 0.3 },
              colors: COLORS,
            }),
          i * 280,
        );
      break;
    }
  }
}

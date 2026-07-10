export let lastDirection: "left" | "right" | "up" | "down" | null = null;

export function setLastDirection(d: typeof lastDirection) {
  lastDirection = d;
}

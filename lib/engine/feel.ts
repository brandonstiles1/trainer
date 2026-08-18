import type { Feeling } from "@/lib/adapt";

/** How a set went, as the user tapped it. */
export type Feel = "easy" | "medium" | "hard";

/** Bridge from the app's logged traffic-light feeling to the engine's feel scale. */
export function feelFromFeeling(feeling: Feeling): Feel {
  switch (feeling) {
    case "green":
      return "easy";
    case "yellow":
      return "medium";
    case "red":
      return "hard";
  }
}

export const FEEL_LABEL: Record<Feel, string> = {
  easy: "easy",
  medium: "okay",
  hard: "hard",
};

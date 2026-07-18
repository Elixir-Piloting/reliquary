export function getSubtleBackground(hex: string, alpha = 0.15): string {
  return hex + Math.round(alpha * 255).toString(16).padStart(2, "0");
}

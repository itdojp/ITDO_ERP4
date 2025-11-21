export function applyRate(minutes: number, unitPrice: number) {
  const hours = minutes / 60;
  return Math.round(hours * unitPrice * 100) / 100;
}

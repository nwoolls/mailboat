/**
 * Space to add so a height of `height` CSS pixels becomes a whole number.
 * A scroll area only scrolls in whole pixels, so content ending part-way
 * through one has its last sliver (the last card's bottom edge) cut off.
 * Tiny floating-point leftovers count as whole.
 */
export function wholePixelSlack(height: number): number {
  const slack = Math.ceil(height - 0.001) - height;
  return slack > 0.001 ? slack : 0;
}

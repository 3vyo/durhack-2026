// Loading the kit's models, with a fallback. Generic over what a model is, so the tests run
// with fakes and never load three.js. scene.ts passes three's GLTFLoader and a Box3 measure.

export interface Size {
  length: number;
  width: number;
  height: number;
}

export interface KitParts<T> {
  cars: T[];
  carSizes: Size[];
  rail: T;
  railSize: Size;
}

/**
 * Loads every car and the rail piece at once. If any load fails, or there are no cars, it
 * returns null and the scene keeps drawing boxes, so the page is never blank. It never throws:
 * a failure is passed to `report` once.
 */
export async function loadKit<T>(
  load: (url: string) => Promise<T>,
  measure: (o: T) => Size,
  urls: { cars: string[]; rail: string },
  report: (e: unknown) => void = () => {},
): Promise<KitParts<T> | null> {
  if (urls.cars.length === 0) return null;
  try {
    const [rail, ...cars] = await Promise.all([load(urls.rail), ...urls.cars.map((u) => load(u))]);
    return { cars, carSizes: cars.map(measure), rail, railSize: measure(rail) };
  } catch (e) {
    report(e);
    return null;
  }
}

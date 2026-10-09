/**
 * Token logos come from Birdeye's `logo_uri`, which points at Arweave, IPFS
 * or a project's own CDN. The image is drawn into the video canvas, so it must
 * load with CORS: an image without it would taint the canvas and block the
 * export. Arweave and the IPFS gateway send CORS headers; anything else goes
 * through an open image proxy that does, resized to the size the clip needs.
 * When neither loads, the clip draws a monogram instead.
 */

const LOAD_TIMEOUT_MS = 5_000;

export function logoCandidates(uri?: string): string[] {
  if (!uri) return [];
  const url = uri.startsWith("ipfs://") ? `https://ipfs.io/ipfs/${uri.slice("ipfs://".length)}` : uri;
  if (!/^https:\/\//i.test(url)) return [];
  return [url, `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=160&h=160&fit=cover&output=png`];
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    const timer = setTimeout(() => finish(null), LOAD_TIMEOUT_MS);
    function finish(result: HTMLImageElement | null) {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve(result);
    }
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => finish(image.naturalWidth > 0 ? image : null);
    image.onerror = () => finish(null);
    image.src = src;
  });
}

const cache = new Map<string, Promise<HTMLImageElement | null>>();

export function loadTokenLogo(uri?: string): Promise<HTMLImageElement | null> {
  if (!uri) return Promise.resolve(null);
  let held = cache.get(uri);
  if (!held) {
    held = (async () => {
      for (const src of logoCandidates(uri)) {
        const image = await loadImage(src);
        if (image) return image;
      }
      return null;
    })();
    cache.set(uri, held);
  }
  return held;
}

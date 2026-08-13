/**
 * Screenshot rules: which device sizes exist, what pixel dimensions each accepts, and how
 * many you may upload. Kept apart from the API calls because almost none of it is
 * discoverable — it lives in the drop-zone captions on the version page.
 */

/**
 * The complete set of display types, taken from iris itself: POST an invalid
 * screenshotDisplayType and the 409 lists every valid one. Authoritative as of Aug 2026.
 */
export const SCREENSHOT_DISPLAY_TYPES = [
  'APP_IPHONE_67',
  'APP_IPHONE_65',
  'APP_IPHONE_61',
  'APP_IPHONE_58',
  'APP_IPHONE_55',
  'APP_IPHONE_47',
  'APP_IPHONE_40',
  'APP_IPHONE_35',
  'APP_IPAD_PRO_3GEN_129',
  'APP_IPAD_PRO_3GEN_11',
  'APP_IPAD_PRO_129',
  'APP_IPAD_105',
  'APP_IPAD_97',
  'APP_WATCH_ULTRA',
  'APP_WATCH_SERIES_10',
  'APP_WATCH_SERIES_7',
  'APP_WATCH_SERIES_4',
  'APP_WATCH_SERIES_3',
  'APP_DESKTOP',
  'APP_APPLE_TV',
  'APP_APPLE_VISION_PRO',
  'IMESSAGE_APP_IPHONE_67',
  'IMESSAGE_APP_IPHONE_65',
  'IMESSAGE_APP_IPHONE_61',
  'IMESSAGE_APP_IPHONE_58',
  'IMESSAGE_APP_IPHONE_55',
  'IMESSAGE_APP_IPHONE_47',
  'IMESSAGE_APP_IPHONE_40',
  'IMESSAGE_APP_IPAD_PRO_3GEN_129',
  'IMESSAGE_APP_IPAD_PRO_3GEN_11',
  'IMESSAGE_APP_IPAD_PRO_129',
  'IMESSAGE_APP_IPAD_105',
  'IMESSAGE_APP_IPAD_97',
] as const;

/** What the version page says it will take, per drop zone. */
export const MAX_SCREENSHOTS = 10;
export const MAX_PREVIEWS = 3;

export type Dimensions = readonly [width: number, height: number];

/**
 * Accepted pixel dimensions per display type, transcribed from the drop-zone captions in
 * App Store Connect. A zone names several device generations at once and takes any of
 * their sizes, so each entry is the union of what its caption lists.
 *
 * Deliberately incomplete: only zones actually read off the page are here, because a
 * wrong entry would reject a perfectly good screenshot. An absent display type simply
 * isn't dimension-checked. To add one, open the version page, read its caption and
 * transcribe it — that is the only source for this.
 */
export const SCREENSHOT_SIZES: Record<string, readonly Dimensions[]> = {
  // "1242 × 2688px, 2688 × 1242px, 1284 × 2778px or 2778 × 1284px"
  APP_IPHONE_65: [
    [1242, 2688],
    [2688, 1242],
    [1284, 2778],
    [2778, 1284],
  ],
  // iPad 12.9" or 13": "2064 × 2752px, 2752 × 2064px, 2048 × 2732px or 2732 × 2048px"
  APP_IPAD_PRO_3GEN_129: [
    [2064, 2752],
    [2752, 2064],
    [2048, 2732],
    [2732, 2048],
  ],
};

/**
 * The watch zone lists every generation together — Ultra 3 (422 × 514, 410 × 502),
 * Series 11 (416 × 496), Series 9 (396 × 484), Series 6 (368 × 448), Series 3
 * (312 × 390) — without saying which display type each belongs to. Rather than guess the
 * mapping, every watch type accepts the union; the server is the one that decides.
 */
const WATCH_SIZES: readonly Dimensions[] = [
  [422, 514],
  [410, 502],
  [416, 496],
  [396, 484],
  [368, 448],
  [312, 390],
];

for (const type of ['APP_WATCH_ULTRA', 'APP_WATCH_SERIES_10', 'APP_WATCH_SERIES_7', 'APP_WATCH_SERIES_4', 'APP_WATCH_SERIES_3']) {
  SCREENSHOT_SIZES[type] = WATCH_SIZES;
}

export interface ImageSize {
  width: number;
  height: number;
}

/**
 * Pixel dimensions straight out of the file header — enough to check a screenshot before
 * spending an upload on it. Returns undefined for anything unrecognised rather than
 * throwing, so an odd format degrades to "unchecked" instead of blocking.
 */
export function readImageSize(file: Buffer): ImageSize | undefined {
  if (file.length > 24 && file.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    // PNG: IHDR is always the first chunk, width and height at a fixed offset.
    return { width: file.readUInt32BE(16), height: file.readUInt32BE(20) };
  }

  if (file.length > 4 && file[0] === 0xff && file[1] === 0xd8) {
    return readJpegSize(file);
  }

  return undefined;
}

/** Walks JPEG segments to the start-of-frame marker, which is where the size lives. */
function readJpegSize(file: Buffer): ImageSize | undefined {
  let i = 2;

  while (i + 9 < file.length) {
    if (file[i] !== 0xff) return undefined;

    const marker = file[i + 1];
    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }

    const length = file.readUInt16BE(i + 2);
    // Every SOFn holds the dimensions except the arithmetic-coding and DHT/JPG oddities.
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
      return { height: file.readUInt16BE(i + 5), width: file.readUInt16BE(i + 7) };
    }

    i += 2 + length;
  }

  return undefined;
}

function formatSize(size: ImageSize | Dimensions): string {
  const [w, h] = Array.isArray(size) ? size : [(size as ImageSize).width, (size as ImageSize).height];
  return `${w} × ${h}`;
}

export interface ScreenshotCheck {
  displayType: string;
  /** Undefined when the file format wasn't recognised. */
  size?: ImageSize;
  /** How many screenshots the set already holds. */
  existing: number;
}

/**
 * Everything wrong with a screenshot before it is uploaded, as readable sentences.
 * An empty array means nothing objectionable was found — not that Apple will accept it,
 * since the server does its own validation on top.
 */
export function checkScreenshot({ displayType, size, existing }: ScreenshotCheck): string[] {
  const problems: string[] = [];

  if (!SCREENSHOT_DISPLAY_TYPES.includes(displayType as (typeof SCREENSHOT_DISPLAY_TYPES)[number])) {
    problems.push(`"${displayType}" is not a display type App Store Connect recognises`);
  }

  if (existing >= MAX_SCREENSHOTS) {
    problems.push(`the set already holds ${existing} screenshots and the limit is ${MAX_SCREENSHOTS}`);
  }

  const accepted = SCREENSHOT_SIZES[displayType];
  if (accepted && size) {
    const fits = accepted.some(([w, h]) => w === size.width && h === size.height);
    if (!fits) {
      problems.push(
        `${formatSize(size)} is not a size ${displayType} accepts — it takes ` +
          accepted.map(formatSize).join(', ')
      );
    }
  }

  return problems;
}

import { createWorker } from 'tesseract.js';

export const OCR_CONFIDENCE_THRESHOLD = 75;

export interface OCRBoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OCRWord {
  text: string;
  confidence: number;
  bbox: OCRBoundingBox;
}

export interface OCRExtractedEntities {
  httpCodes: number[];
  uuids: string[];
  ipAddresses: string[];
  transactionHashes: string[];
}

export interface OCRResult {
  text: string;
  confidence: number;
  accepted: boolean;
  words: OCRWord[];
  entities: OCRExtractedEntities;
}

type TesseractWorker = {
  recognize: (image: unknown) => Promise<any>;
  terminate: () => Promise<unknown>;
};

export class OCRProcessor {
  private worker: TesseractWorker | null = null;
  private workerPromise: Promise<TesseractWorker> | null = null;
  private disposed = false;

  private async getWorker(): Promise<TesseractWorker> {
    if (this.disposed) {
      throw new Error('OCRProcessor has been disposed.');
    }

    if (this.worker) {
      return this.worker;
    }

    if (!this.workerPromise) {
      this.workerPromise = createWorker('eng', 1, {
        logger: () => {},
      }).then((worker) => {
        if (this.disposed) {
          void worker.terminate();
          throw new Error('OCRProcessor has been disposed.');
        }

        this.worker = worker as unknown as TesseractWorker;
        return this.worker;
      }).catch((error) => {
        this.workerPromise = null;
        throw error;
      });
    }

    return this.workerPromise;
  }

  /**
   * Converts an image to grayscale, stretches contrast and applies
   * Otsu thresholding. If canvas APIs are unavailable, returns
   * the original image so OCR can still be attempted.
   */
  async preprocessImage(image: unknown): Promise<unknown> {
    if (typeof document === 'undefined' || !image) {
      return image;
    }

    try {
      const source = await this.resolveImageSource(image);
      if (!source) return image;

      const canvas = document.createElement('canvas');
      canvas.width = source.width;
      canvas.height = source.height;

      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context || !canvas.width || !canvas.height) return image;

      context.drawImage(source, 0, 0, canvas.width, canvas.height);

      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;
      const histogram = new Array<number>(256).fill(0);
      const grayscale = new Uint8Array(pixels.length / 4);

      let minGray = 255;
      let maxGray = 0;

      for (let i = 0; i < pixels.length; i += 4) {
        const gray = Math.round(
          0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2],
        );

        grayscale[i / 4] = gray;
        histogram[gray]++;
        minGray = Math.min(minGray, gray);
        maxGray = Math.max(maxGray, gray);
      }

      const range = maxGray - minGray || 1;
      const stretchedHistogram = new Array<number>(256).fill(0);

      for (const gray of grayscale) {
        const stretched = Math.round(((gray - minGray) / range) * 255);
        stretchedHistogram[stretched]++;
      }

      const threshold =
        OCRProcessor.calculateOtsuThreshold(stretchedHistogram);

      for (let i = 0; i < pixels.length; i += 4) {
        const gray = grayscale[i / 4];
        const stretched = Math.round(((gray - minGray) / range) * 255);
        const value = stretched >= threshold ? 255 : 0;

        pixels[i] = value;
        pixels[i + 1] = value;
        pixels[i + 2] = value;
      }

      context.putImageData(imageData, 0, 0);
      return canvas;
    } catch {
      return image;
    }
  }

  private async resolveImageSource(image: unknown): Promise<any> {
    if (typeof image === 'string') {
      return this.loadImage(image);
    }

    if (typeof Blob !== 'undefined' && image instanceof Blob) {
      const objectUrl = URL.createObjectURL(image);

      try {
        return await this.loadImage(objectUrl);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }

    return image;
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Unable to load image.'));
      img.src = src;
    });
  }

  /**
   * Recognizes image text and extracts common troubleshooting identifiers.
   */
  async processImage(image: unknown): Promise<OCRResult> {
    if (!image) {
      throw new Error('An image is required for OCR.');
    }

    if (this.disposed) {
      throw new Error('OCRProcessor has been disposed.');
    }

    const processedImage = await this.preprocessImage(image);
    const worker = await this.getWorker();
    const recognition = await worker.recognize(processedImage);
    const data = recognition?.data ?? {};

    const text = typeof data.text === 'string' ? data.text.trim() : '';
    const confidence = Number(data.confidence) || 0;
    const words = OCRProcessor.extractWords(data.words);

    return {
      text,
      confidence,
      accepted: confidence >= OCR_CONFIDENCE_THRESHOLD,
      words,
      entities: OCRProcessor.extractEntities(text),
    };
  }

  static extractWords(rawWords: any[] = []): OCRWord[] {
    if (!Array.isArray(rawWords)) return [];

    return rawWords
      .filter((word) => word && typeof word.text === 'string')
      .map((word) => ({
        text: word.text.trim(),
        confidence: Number(word.confidence) || 0,
        bbox: {
          x0: Number(word.bbox?.x0) || 0,
          y0: Number(word.bbox?.y0) || 0,
          x1: Number(word.bbox?.x1) || 0,
          y1: Number(word.bbox?.y1) || 0,
        },
      }))
      .filter((word) => word.text.length > 0);
  }

  static extractEntities(text: string): OCRExtractedEntities {
    const httpCodes = new Set<number>();
    const uuids = new Set<string>();
    const ipAddresses = new Set<string>();
    const transactionHashes = new Set<string>();

    const httpRegex = /\bHTTP(?:\/\d(?:\.\d)?)?\s*[: ]\s*([1-5]\d{2})\b|\bstatus(?:\s+code)?\s*[:=]\s*([1-5]\d{2})\b|\b([1-5]\d{2})\s+(?:Bad Request|Unauthorized|Forbidden|Not Found|Internal Server Error|Bad Gateway|Service Unavailable)\b/gi;

    for (const match of text.matchAll(httpRegex)) {
      const code = Number(match[1] || match[2] || match[3]);
      if (code >= 100 && code <= 599) httpCodes.add(code);
    }

    const uuidRegex =
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

    for (const match of text.matchAll(uuidRegex)) {
      uuids.add(match[0]);
    }

    const ipRegex = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

    for (const match of text.matchAll(ipRegex)) {
      const parts = match[0].split('.').map(Number);
      if (parts.every((part) => part >= 0 && part <= 255)) {
        ipAddresses.add(match[0]);
      }
    }

    const hashRegex = /\b(?:0x)?[a-f0-9]{64}\b/gi;

    for (const match of text.matchAll(hashRegex)) {
      transactionHashes.add(match[0]);
    }

    return {
      httpCodes: [...httpCodes],
      uuids: [...uuids],
      ipAddresses: [...ipAddresses],
      transactionHashes: [...transactionHashes],
    };
  }

  /**
   * Otsu threshold calculation from a grayscale histogram.
   */
  static calculateOtsuThreshold(histogram: number[]): number {
    const total = histogram.reduce((sum, value) => sum + value, 0);
    if (total === 0) return 0;

    let sum = 0;
    for (let i = 0; i < histogram.length; i++) {
      sum += i * histogram[i];
    }

    let backgroundWeight = 0;
    let backgroundSum = 0;
    let maximumVariance = -1;
    let threshold = 0;

    for (let i = 0; i < histogram.length; i++) {
      backgroundWeight += histogram[i];
      if (backgroundWeight === 0) continue;

      const foregroundWeight = total - backgroundWeight;
      if (foregroundWeight === 0) break;

      backgroundSum += i * histogram[i];

      const backgroundMean = backgroundSum / backgroundWeight;
      const foregroundMean = (sum - backgroundSum) / foregroundWeight;

      const variance =
        backgroundWeight *
        foregroundWeight *
        (backgroundMean - foregroundMean) ** 2;

      if (variance > maximumVariance) {
        maximumVariance = variance;
        threshold = i;
      }
    }

    return threshold;
  }

  /**
   * Terminates the worker and prevents future recognition calls.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;

    this.disposed = true;

    const worker = this.worker ?? (await this.workerPromise?.catch(() => null));
    this.worker = null;
    this.workerPromise = null;

    if (worker) {
      await worker.terminate();
    }
  }
}

export default OCRProcessor;

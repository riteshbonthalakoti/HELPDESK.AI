import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRecognize = vi.fn();
const mockTerminate = vi.fn();
const mockCreateWorker = vi.fn();

vi.mock('tesseract.js', () => ({
  createWorker: (...args: unknown[]) => mockCreateWorker(...args),
}));

import OCRProcessor from '../../lib/ocr/OCRProcessor';

describe('OCRProcessor', () => {
  let processor: OCRProcessor;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRecognize.mockResolvedValue({
      data: {
        text: 'HTTP 500 Internal Server Error',
        confidence: 90,
        words: [
          {
            text: 'HTTP',
            confidence: 95,
            bbox: { x0: 10, y0: 20, x1: 40, y1: 50 },
          },
          {
            text: '500',
            confidence: 91,
            bbox: { x0: 45, y0: 20, x1: 70, y1: 50 },
          },
        ],
      },
    });

    mockTerminate.mockResolvedValue(undefined);
    mockCreateWorker.mockResolvedValue({
      recognize: mockRecognize,
      terminate: mockTerminate,
    });

    processor = new OCRProcessor();
  });

  it('creates an English OCR worker lazily', async () => {
    expect(mockCreateWorker).not.toHaveBeenCalled();

    await processor.processImage('test-image');

    expect(mockCreateWorker).toHaveBeenCalledWith(
      'eng',
      1,
      expect.objectContaining({ logger: expect.any(Function) }),
    );
  });

  it('reuses the worker across recognition calls', async () => {
    await processor.processImage('image-1');
    await processor.processImage('image-2');

    expect(mockCreateWorker).toHaveBeenCalledTimes(1);
    expect(mockRecognize).toHaveBeenCalledTimes(2);
  });

  it('returns recognized text and confidence', async () => {
    const result = await processor.processImage('image');

    expect(result.text).toBe('HTTP 500 Internal Server Error');
    expect(result.confidence).toBe(90);
    expect(result.accepted).toBe(true);
  });

  it('accepts confidence exactly at the threshold', async () => {
    mockRecognize.mockResolvedValueOnce({
      data: { text: 'Readable', confidence: 75, words: [] },
    });

    const result = await processor.processImage('image');

    expect(result.accepted).toBe(true);
  });

  it('rejects OCR confidence below 75%', async () => {
    mockRecognize.mockResolvedValueOnce({
      data: { text: 'Poor quality', confidence: 74.9, words: [] },
    });

    const result = await processor.processImage('image');

    expect(result.accepted).toBe(false);
  });

  it('extracts recognized word bounding boxes', async () => {
    const result = await processor.processImage('image');

    expect(result.words).toHaveLength(2);
    expect(result.words[0]).toEqual({
      text: 'HTTP',
      confidence: 95,
      bbox: { x0: 10, y0: 20, x1: 40, y1: 50 },
    });
  });

  it('extracts HTTP status codes', () => {
    const result = OCRProcessor.extractEntities(
      'HTTP 404 Not Found and status code: 503',
    );

    expect(result.httpCodes).toEqual([404, 503]);
  });

  it('extracts UUIDs without restricting the version field', () => {
    const uuid = '00000000-0000-0000-0000-000000000000';

    expect(OCRProcessor.extractEntities(`Request id: ${uuid}`).uuids).toEqual([
      uuid,
    ]);
  });

  it('extracts valid IP addresses and ignores invalid ones', () => {
    const result = OCRProcessor.extractEntities(
      'Server 192.168.1.10 and invalid 999.999.999.999',
    );

    expect(result.ipAddresses).toEqual(['192.168.1.10']);
  });

  it('extracts 64-character transaction hashes', () => {
    const hash = 'a'.repeat(64);

    expect(
      OCRProcessor.extractEntities(`Transaction hash: ${hash}`)
        .transactionHashes,
    ).toEqual([hash]);
  });

  it('removes duplicate extracted entities', () => {
    const result = OCRProcessor.extractEntities(
      'HTTP 500 HTTP 500 192.168.1.1 192.168.1.1',
    );

    expect(result.httpCodes).toEqual([500]);
    expect(result.ipAddresses).toEqual(['192.168.1.1']);
  });

  it('calculates Otsu threshold for a bimodal histogram', () => {
    const histogram = new Array(256).fill(0);
    histogram[20] = 100;
    histogram[220] = 100;

    const threshold = OCRProcessor.calculateOtsuThreshold(histogram);

    expect(threshold).toBeGreaterThanOrEqual(20);
    expect(threshold).toBeLessThan(220);
  });

  it('returns zero for an empty histogram', () => {
    expect(OCRProcessor.calculateOtsuThreshold([])).toBe(0);
  });

  it('throws when no image is supplied', async () => {
    await expect(processor.processImage(null)).rejects.toThrow(
      'An image is required for OCR.',
    );
  });

  it('propagates OCR worker errors', async () => {
    mockRecognize.mockRejectedValueOnce(new Error('OCR failed'));

    await expect(processor.processImage('image')).rejects.toThrow('OCR failed');
  });

  it('terminates the worker when disposed', async () => {
    await processor.processImage('image');
    await processor.dispose();

    expect(mockTerminate).toHaveBeenCalledTimes(1);
  });

  it('does not allow recognition after disposal', async () => {
    await processor.dispose();

    await expect(processor.processImage('image')).rejects.toThrow(
      'OCRProcessor has been disposed.',
    );
  });

  it('disposes safely more than once', async () => {
    await processor.processImage('image');

    await processor.dispose();
    await processor.dispose();

    expect(mockTerminate).toHaveBeenCalledTimes(1);
  });
});

export type OCRResult = { text: string; confidence: number; pages: number };

async function imageOCR(file: Blob): Promise<OCRResult> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const result = await worker.recognize(file);
    return { text: result.data.text, confidence: result.data.confidence / 100, pages: 1 };
  } finally {
    await worker.terminate();
  }
}

async function pdfText(file: File): Promise<OCRResult> {
  const pdfjs = await import("pdfjs-dist");
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  const text = pages.join("\n").trim();
  if (text.length > 40) return { text, confidence: 0.92, pages: pdf.numPages };
  throw new Error("This PDF has no readable text layer. Please use a clear image export or configure PDF page OCR.");
}

export async function extractBillText(file: File, onProgress?: (value: number) => void): Promise<OCRResult> {
  onProgress?.(0.08);
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const result = await pdfText(file);
    onProgress?.(1);
    return result;
  }
  onProgress?.(0.2);
  const result = await imageOCR(file);
  onProgress?.(1);
  return result;
}

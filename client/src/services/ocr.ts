export type OCRResult = { text: string; confidence: number; pages: number };

type Progress = (value: number) => void;

async function imageOCR(file: Blob, onProgress?: Progress): Promise<OCRResult> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const result = await worker.recognize(file);
    onProgress?.(0.94);
    return {
      text: result.data.text,
      confidence: result.data.confidence / 100,
      pages: 1,
    };
  } finally {
    await worker.terminate();
  }
}

async function pdfText(file: File, onProgress?: Progress): Promise<OCRResult> {
  const pdfjs = await import("pdfjs-dist");
  const pdf = await pdfjs.getDocument({
    data: await file.arrayBuffer(),
    useSystemFonts: true,
  }).promise;
  const pages: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items.map(item => ("str" in item ? item.str : "")).join(" ")
      );
    }
    const text = pages.join("\n").trim();
    if (text.length > 40) {
      onProgress?.(0.94);
      return { text, confidence: 0.92, pages: pdf.numPages };
    }

    // Scanned PDFs have no text layer. Render one page at a time so OCR uses
    // bounded memory and the original PDF never leaves the browser.
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    const recognized: string[] = [];
    let confidenceTotal = 0;
    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.8 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d");
        if (!context)
          throw new Error(
            "This browser could not prepare the PDF page for OCR."
          );
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        const result = await worker.recognize(canvas);
        recognized.push(result.data.text);
        confidenceTotal += result.data.confidence / 100;
        canvas.width = 0;
        canvas.height = 0;
        onProgress?.(0.1 + (pageNumber / pdf.numPages) * 0.82);
      }
    } finally {
      await worker.terminate();
    }
    const scannedText = recognized.join("\n").trim();
    if (scannedText.length < 15) {
      throw new Error(
        "This scanned PDF could not be read. Upload a clearer scan or an image export of the bill."
      );
    }
    return {
      text: scannedText,
      confidence: pdf.numPages ? confidenceTotal / pdf.numPages : 0,
      pages: pdf.numPages,
    };
  } finally {
    await pdf.cleanup();
  }
}

export async function extractBillText(
  file: File,
  onProgress?: Progress
): Promise<OCRResult> {
  onProgress?.(0.08);
  if (
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  ) {
    const result = await pdfText(file, onProgress);
    onProgress?.(1);
    return result;
  }
  onProgress?.(0.2);
  const result = await imageOCR(file, onProgress);
  onProgress?.(1);
  return result;
}

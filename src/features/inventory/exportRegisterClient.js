// Main-thread side of the 財產清冊 export: runs the build in a worker, reports
// progress, supports cancelling, then saves the file.  Kept free of jsPDF so
// the page does not pull the PDF library in a second time.

const rocStamp = (date = new Date()) =>
  [date.getFullYear() - 1911, date.getMonth() + 1, date.getDate()]
    .map((value, index) => String(value).padStart(index ? 2 : 3, "0"))
    .join("");

function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const abortError = () => new DOMException("匯出已取消。", "AbortError");

function buildInWorker(format, assets, meta, { onProgress, signal }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./exportRegisterWorker.js", import.meta.url), {
      type: "module",
    });
    const finish = (callback) => (value) => {
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      callback(value);
    };
    const done = finish(resolve);
    const fail = finish(reject);
    function onAbort() {
      fail(abortError());
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") onProgress?.(data.fraction, data.label);
      else if (data.type === "done") done(data.blob);
      else fail(new Error(data.message || "匯出財產清冊失敗。"));
    };
    worker.onerror = (event) => fail(new Error(event.message || "匯出財產清冊失敗。"));
    worker.postMessage({ format, assets, meta });
  });
}

/** Builds and downloads the register.  format: "pdf" | "xlsx". Returns the file name. */
export async function exportAssetRegister(format, assets, meta, options = {}) {
  if (!assets.length) throw new Error("目前沒有可匯出的財物。");
  if (options.signal?.aborted) throw abortError();
  let blob;
  if (typeof Worker === "function") {
    blob = await buildInWorker(format, assets, meta, options);
  } else {
    // Very old browsers: build on the main thread (the page will pause).
    const builders = await import("./exportAssetRegister");
    const build = format === "xlsx" ? builders.buildRegisterWorkbook : builders.buildRegisterPdf;
    blob = await build(assets, { ...meta, onProgress: options.onProgress });
  }
  const fileName = `財產清冊_${rocStamp()}_${assets.length}筆.${format === "xlsx" ? "xlsx" : "pdf"}`;
  saveBlob(blob, fileName);
  return fileName;
}

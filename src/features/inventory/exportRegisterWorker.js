// Builds the 財產清冊 off the main thread so the page stays usable and the
// export can be cancelled (the caller simply terminates this worker).
import { buildRegisterPdf, buildRegisterWorkbook } from "./exportAssetRegister";

self.onmessage = async ({ data }) => {
  const { format, assets, meta } = data;
  const onProgress = (fraction, label) =>
    self.postMessage({ type: "progress", fraction, label });
  try {
    const build = format === "xlsx" ? buildRegisterWorkbook : buildRegisterPdf;
    const blob = await build(assets, { ...meta, onProgress });
    self.postMessage({ type: "done", blob });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

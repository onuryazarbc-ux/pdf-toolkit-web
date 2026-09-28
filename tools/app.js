// PDF Toolkit Web — all PDF processing happens locally in your browser.

const { PDFDocument, degrees } = PDFLib;

const extpay = { getUser: () => Promise.resolve({paid:true}), onPaid: {addListener: () => {}}, openPaymentPage: () => { window.location.href = "../index.html#pricing"; } };

const FREE_MERGE_LIMIT = 999;

let isPaid = true;

// ============================================================
// Payment status
// ============================================================

const proTag = document.getElementById("proTag");
const upsellBanner = document.getElementById("upsellBanner");
const upsellText = document.getElementById("upsellText");
const upgradeBtn = document.getElementById("upgradeBtn");

extpay.getUser()
  .then((user) => {
    isPaid = !!user.paid;
    onPaymentStatusChange();
  })
  .catch(() => {
    isPaid = false;
    onPaymentStatusChange();
  });

extpay.onPaid.addListener(() => {
  isPaid = true;
  onPaymentStatusChange();
  setStatus("🎉 Pro is now active! All features are unlocked.", "success");
});

upgradeBtn.addEventListener("click", () => extpay.openPaymentPage());

function onPaymentStatusChange() {
  proTag.classList.toggle("hidden", !isPaid);
  updateUpsellBanner();
  updateMergeButtonState();
  updateCompressPanel();
  renderMergeFileList();
}

function updateUpsellBanner() {
  if (isPaid) {
    upsellBanner.classList.add("hidden");
    return;
  }
  if (activeTab === "compress") {
    upsellText.innerHTML = "🔒 Compression is a Pro feature. For unlimited merging, page editing, and compression:";
    upsellBanner.classList.remove("hidden");
  } else if (activeTab === "merge") {
    upsellText.innerHTML = "🔓 Free: merge up to <strong>2 files</strong>. For unlimited files + page editing:";
    upsellBanner.classList.remove("hidden");
  } else {
    upsellBanner.classList.add("hidden");
  }
}

// ============================================================
// Tab switching
// ============================================================

let activeTab = "merge";
const tabButtons = document.querySelectorAll(".tab");
const panels = {
  merge: document.getElementById("panel-merge"),
  split: document.getElementById("panel-split"),
  compress: document.getElementById("panel-compress"),
};

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    activeTab = btn.dataset.tab;
    tabButtons.forEach((b) => b.classList.toggle("active", b === btn));
    Object.entries(panels).forEach(([key, el]) => el.classList.toggle("active", key === activeTab));
    setStatus("");
    updateUpsellBanner();
  });
});

function setStatus(message, type = "") {
  const statusEl = document.getElementById("status");
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function bytesToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Downloads via the background service worker using chrome.downloads —
// this is what lets us reliably reveal the finished file in the OS file
// explorer once it's done, instead of the old silent <a download> click
// (which works, but leaves the file with zero visible confirmation since
// the popup closes the instant the download starts).
async function downloadBlob(bytes, filename) {
  try {
    const dataUrl = `data:application/pdf;base64,${bytesToBase64(bytes)}`;
    const response = await chrome.runtime.sendMessage({ type: "download-file", dataUrl, filename });
    if (!response || !response.ok) throw new Error(response?.error || "Unknown download error");
  } catch (err) {
    console.warn("Background download failed, falling back to direct download:", err);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

// ============================================================
// MERGE
// ============================================================

const mergeFileInput = document.getElementById("mergeFileInput");
const mergeDropzone = document.getElementById("mergeDropzone");
const mergeFileListEl = document.getElementById("mergeFileList");
const mergeBtn = document.getElementById("mergeBtn");
const mergeBtnText = document.getElementById("mergeBtnText");

let mergeFiles = [];
let mergeIdCounter = 0;
let mergeDragSrcId = null;

function mergeReadyFiles() {
  return mergeFiles.filter((f) => f.status === "ready");
}

function updateMergeButtonState() {
  const ready = mergeReadyFiles();
  const readyCount = ready.length;
  mergeBtn.classList.remove("locked-tier");

  if (readyCount < 2) {
    mergeBtn.disabled = true;
    mergeBtnText.textContent = mergeFiles.length === 0 ? "Merge PDFs" : "At least 2 valid PDFs required";
    return;
  }

  if (!isPaid && readyCount > FREE_MERGE_LIMIT) {
    mergeBtn.disabled = false;
    mergeBtn.classList.add("locked-tier");
    mergeBtnText.textContent = `🔒 Pro required for ${readyCount} files · $4.99`;
    return;
  }

  mergeBtn.disabled = false;
  mergeBtnText.textContent = `Merge ${readyCount} PDFs`;
}

function addMergeFiles(fileArray) {
  const pdfFiles = fileArray.filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (pdfFiles.length === 0) {
    setStatus("Please select valid PDF files.", "error");
    return;
  }
  pdfFiles.forEach((file) => {
    const item = { id: mergeIdCounter++, file, status: "loading", pageCount: 0, pages: [], expanded: false };
    mergeFiles.push(item);
    analyzeMergeFile(item);
  });
  renderMergeFileList();
  setStatus("");
}

async function analyzeMergeFile(item) {
  try {
    const arrayBuffer = await item.file.arrayBuffer();
    const pdf = await PDFDocument.load(arrayBuffer);
    const pageCount = pdf.getPageCount();
    item.status = "ready";
    item.pageCount = pageCount;
    item.pages = Array.from({ length: pageCount }, (_, i) => ({ index: i, included: true, rotation: 0 }));
  } catch (err) {
    item.status = "locked";
    item.errorMessage =
      err instanceof PDFLib.EncryptedPDFError
        ? "This PDF is password-protected. Please remove the password before adding it."
        : "This file couldn't be read. It may be corrupted or not a valid PDF.";
  }
  renderMergeFileList();
}

function renderPageEditor(item) {
  const wrap = document.createElement("div");
  wrap.className = "page-editor" + (!isPaid ? " pro-locked" : "");

  const hint = document.createElement("p");
  hint.className = "page-editor-hint";
  hint.textContent = `${item.pageCount} pages · Click to exclude a page, double-click to rotate it.`;
  wrap.appendChild(hint);

  const chipContainer = document.createElement("div");
  chipContainer.className = "page-chips";

  item.pages.forEach((page) => {
    const chip = document.createElement("div");
    chip.className = "page-chip" + (page.included ? "" : " excluded");
    const label = document.createElement("span");
    label.textContent = String(page.index + 1);
    chip.appendChild(label);
    if (page.rotation !== 0) {
      const rot = document.createElement("span");
      rot.className = "rot-indicator";
      rot.textContent = "↻";
      chip.appendChild(rot);
    }
    chip.addEventListener("click", () => {
      page.included = !page.included;
      renderMergeFileList();
    });
    chip.addEventListener("dblclick", (e) => {
      e.preventDefault();
      page.rotation = (page.rotation + 90) % 360;
      renderMergeFileList();
    });
    chipContainer.appendChild(chip);
  });
  wrap.appendChild(chipContainer);

  const actions = document.createElement("div");
  actions.className = "page-chip-actions";
  const selectAllBtn = document.createElement("button");
  selectAllBtn.textContent = "Include All";
  selectAllBtn.addEventListener("click", () => {
    item.pages.forEach((p) => (p.included = true));
    renderMergeFileList();
  });
  const rotateAllBtn = document.createElement("button");
  rotateAllBtn.textContent = "Rotate All (90°)";
  rotateAllBtn.addEventListener("click", () => {
    item.pages.forEach((p) => (p.rotation = (p.rotation + 90) % 360));
    renderMergeFileList();
  });
  actions.appendChild(selectAllBtn);
  actions.appendChild(rotateAllBtn);
  wrap.appendChild(actions);

  if (!isPaid) {
    const overlay = document.createElement("div");
    overlay.className = "pro-lock-overlay";
    overlay.innerHTML = "🔒 Page editing is a Pro feature";
    overlay.addEventListener("click", () => extpay.openPaymentPage());
    wrap.style.position = "relative";
    wrap.appendChild(overlay);
  }

  return wrap;
}

function renderMergeFileList() {
  mergeFileListEl.innerHTML = "";
  mergeFiles.forEach((item) => {
    const li = document.createElement("li");
    li.className = "file-item" + (item.status === "locked" ? " locked" : "");
    li.draggable = item.status !== "locked";
    li.dataset.id = item.id;

    const row = document.createElement("div");
    row.className = "file-row";

    const handle = document.createElement("span");
    handle.className = "handle";
    handle.textContent = "⠿";
    row.appendChild(handle);

    if (item.status === "locked") {
      const lockIcon = document.createElement("span");
      lockIcon.className = "lock-icon";
      lockIcon.textContent = "🔒";
      row.appendChild(lockIcon);
    }

    const name = document.createElement("span");
    name.className = "name";
    name.title = item.file.name;
    name.textContent = item.file.name;
    if (item.status === "ready") {
      name.addEventListener("click", () => {
        item.expanded = !item.expanded;
        renderMergeFileList();
      });
    }
    row.appendChild(name);

    const meta = document.createElement("span");
    meta.className = "meta";
    if (item.status === "loading") meta.textContent = "Loading…";
    else if (item.status === "ready") {
      const included = item.pages.filter((p) => p.included).length;
      meta.textContent = included === item.pageCount ? `${item.pageCount} pages` : `${included}/${item.pageCount} pages`;
    } else meta.textContent = formatSize(item.file.size);
    row.appendChild(meta);

    if (item.status === "ready") {
      const expandToggle = document.createElement("button");
      expandToggle.className = "expand-toggle";
      expandToggle.textContent = item.expanded ? "▲" : "▼";
      expandToggle.title = "Edit pages";
      expandToggle.addEventListener("click", () => {
        item.expanded = !item.expanded;
        renderMergeFileList();
      });
      row.appendChild(expandToggle);
    }

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove";
    removeBtn.textContent = "✕";
    removeBtn.title = "Remove";
    removeBtn.addEventListener("click", () => {
      mergeFiles = mergeFiles.filter((f) => f.id !== item.id);
      renderMergeFileList();
    });
    row.appendChild(removeBtn);

    li.appendChild(row);

    if (item.status === "locked" && item.errorMessage) {
      const msg = document.createElement("p");
      msg.className = "locked-message";
      msg.textContent = item.errorMessage;
      li.appendChild(msg);
    }

    if (item.status === "ready" && item.expanded) {
      li.appendChild(renderPageEditor(item));
    }

    li.addEventListener("dragstart", (e) => {
      if (item.status === "locked") return;
      mergeDragSrcId = item.id;
      li.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    li.addEventListener("dragend", () => li.classList.remove("dragging"));
    li.addEventListener("dragover", (e) => e.preventDefault());
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      if (mergeDragSrcId === null || mergeDragSrcId === item.id) return;
      const fromIndex = mergeFiles.findIndex((f) => f.id === mergeDragSrcId);
      const toIndex = mergeFiles.findIndex((f) => f.id === item.id);
      const [moved] = mergeFiles.splice(fromIndex, 1);
      mergeFiles.splice(toIndex, 0, moved);
      mergeDragSrcId = null;
      renderMergeFileList();
    });

    mergeFileListEl.appendChild(li);
  });

  updateMergeButtonState();
}

mergeFileInput.addEventListener("change", (e) => {
  addMergeFiles(Array.from(e.target.files));
  mergeFileInput.value = "";
});

["dragenter", "dragover"].forEach((evt) =>
  mergeDropzone.addEventListener(evt, (e) => { e.preventDefault(); mergeDropzone.classList.add("dragover"); })
);
["dragleave", "drop"].forEach((evt) =>
  mergeDropzone.addEventListener(evt, (e) => { e.preventDefault(); mergeDropzone.classList.remove("dragover"); })
);
mergeDropzone.addEventListener("drop", (e) => {
  const dropped = Array.from(e.dataTransfer.files || []);
  if (dropped.length) addMergeFiles(dropped);
});

mergeBtn.addEventListener("click", async () => {
  const ready = mergeReadyFiles();
  if (ready.length < 2) return;
  if (!isPaid && ready.length > FREE_MERGE_LIMIT) {
    extpay.openPaymentPage();
    return;
  }

  mergeBtn.disabled = true;
  setStatus("Merging...", "");

  try {
    const mergedPdf = await PDFDocument.create();
    for (const item of ready) {
      const arrayBuffer = await item.file.arrayBuffer();
      const srcPdf = await PDFDocument.load(arrayBuffer);
      const includedIndices = item.pages.filter((p) => p.included).map((p) => p.index);
      if (includedIndices.length === 0) continue;
      const copiedPages = await mergedPdf.copyPages(srcPdf, includedIndices);
      const includedStates = item.pages.filter((p) => p.included);
      copiedPages.forEach((page, i) => {
        const rotation = includedStates[i].rotation;
        if (rotation !== 0) {
          const current = page.getRotation().angle || 0;
          page.setRotation(degrees((current + rotation) % 360));
        }
        mergedPdf.addPage(page);
      });
    }
    if (mergedPdf.getPageCount() === 0) {
      setStatus("No pages left to merge — all pages were excluded.", "error");
      updateMergeButtonState();
      return;
    }
    const mergedBytes = await mergedPdf.save();
    await downloadBlob(mergedBytes, "merged.pdf");
    setStatus(`✓ Successfully merged ${ready.length} PDFs.`, "success");
  } catch (err) {
    console.error(err);
    setStatus("Error: one of the files couldn't be processed. Please try again.", "error");
  } finally {
    updateMergeButtonState();
  }
});

// ============================================================
// SPLIT — free, unlimited
// ============================================================

const splitFileInput = document.getElementById("splitFileInput");
const splitDropzone = document.getElementById("splitDropzone");
const splitEditor = document.getElementById("splitEditor");
const splitFileName = document.getElementById("splitFileName");
const splitHint = document.getElementById("splitHint");
const splitChips = document.getElementById("splitChips");
const splitBtn = document.getElementById("splitBtn");
const splitBtnText = document.getElementById("splitBtnText");
const splitSelectAll = document.getElementById("splitSelectAll");
const splitSelectNone = document.getElementById("splitSelectNone");

let splitState = null; // { file, pageCount, selected: Set }

splitFileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) loadSplitFile(file);
  splitFileInput.value = "";
});
["dragenter", "dragover"].forEach((evt) =>
  splitDropzone.addEventListener(evt, (e) => { e.preventDefault(); splitDropzone.classList.add("dragover"); })
);
["dragleave", "drop"].forEach((evt) =>
  splitDropzone.addEventListener(evt, (e) => { e.preventDefault(); splitDropzone.classList.remove("dragover"); })
);
splitDropzone.addEventListener("drop", (e) => {
  const file = (e.dataTransfer.files || [])[0];
  if (file) loadSplitFile(file);
});

async function loadSplitFile(file) {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    setStatus("Please select a valid PDF file.", "error");
    return;
  }
  setStatus("Reading file...", "");
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await PDFDocument.load(arrayBuffer);
    const pageCount = pdf.getPageCount();
    splitState = { file, pageCount, selected: new Set(Array.from({ length: pageCount }, (_, i) => i)) };
    renderSplitEditor();
    setStatus("");
  } catch (err) {
    const msg =
      err instanceof PDFLib.EncryptedPDFError
        ? "This PDF is password-protected. Please remove the password first."
        : "This file couldn't be read. It may be corrupted or not a valid PDF.";
    setStatus(msg, "error");
    splitState = null;
    splitEditor.classList.add("hidden");
    updateSplitButtonState();
  }
}

function renderSplitEditor() {
  if (!splitState) {
    splitEditor.classList.add("hidden");
    updateSplitButtonState();
    return;
  }
  splitEditor.classList.remove("hidden");
  splitFileName.textContent = splitState.file.name;
  splitHint.textContent = `${splitState.pageCount} pages · Select the pages to include in the new PDF.`;

  splitChips.innerHTML = "";
  for (let i = 0; i < splitState.pageCount; i++) {
    const chip = document.createElement("div");
    const isSelected = splitState.selected.has(i);
    chip.className = "page-chip" + (isSelected ? " selected" : " excluded");
    chip.textContent = String(i + 1);
    chip.addEventListener("click", () => {
      if (isSelected) splitState.selected.delete(i);
      else splitState.selected.add(i);
      renderSplitEditor();
    });
    splitChips.appendChild(chip);
  }
  updateSplitButtonState();
}

splitSelectAll.addEventListener("click", () => {
  if (!splitState) return;
  splitState.selected = new Set(Array.from({ length: splitState.pageCount }, (_, i) => i));
  renderSplitEditor();
});
splitSelectNone.addEventListener("click", () => {
  if (!splitState) return;
  splitState.selected = new Set();
  renderSplitEditor();
});

function updateSplitButtonState() {
  const count = splitState ? splitState.selected.size : 0;
  splitBtn.disabled = count === 0;
  splitBtnText.textContent = count === 0 ? "Select Pages" : `Split ${count} Pages Into New PDF`;
}

splitBtn.addEventListener("click", async () => {
  if (!splitState || splitState.selected.size === 0) return;
  splitBtn.disabled = true;
  setStatus("Splitting...", "");
  try {
    const arrayBuffer = await splitState.file.arrayBuffer();
    const srcPdf = await PDFDocument.load(arrayBuffer);
    const sortedIndices = Array.from(splitState.selected).sort((a, b) => a - b);
    const newPdf = await PDFDocument.create();
    const copiedPages = await newPdf.copyPages(srcPdf, sortedIndices);
    copiedPages.forEach((p) => newPdf.addPage(p));
    const bytes = await newPdf.save();
    await downloadBlob(bytes, "split.pdf");
    setStatus(`✓ ${sortedIndices.length} pages split into a new PDF.`, "success");
  } catch (err) {
    console.error(err);
    setStatus("Error: the file couldn't be processed. Please try again.", "error");
  } finally {
    updateSplitButtonState();
  }
});

// ============================================================
// COMPRESS — Pro feature
// ============================================================

const compressDropzone = document.getElementById("compressDropzone");
const compressFileInput = document.getElementById("compressFileInput");
const compressBtn = document.getElementById("compressBtn");
const compressBtnText = document.getElementById("compressBtnText");
const compressLockedNotice = document.getElementById("compressLockedNotice");
const compressResult = document.getElementById("compressResult");
const compressBefore = document.getElementById("compressBefore");
const compressAfter = document.getElementById("compressAfter");
const compressSavings = document.getElementById("compressSavings");

let selectedCompressLevel = "balanced";
const COMPRESS_LEVELS = {
  light: { maxDimension: 2000, quality: 0.82, minQuality: 0.5, label: "Light" },
  balanced: { maxDimension: 1600, quality: 0.62, minQuality: 0.3, label: "Balanced" },
  strong: { maxDimension: 1000, quality: 0.4, minQuality: 0.15, label: "Strong" },
};

document.querySelectorAll(".compress-level-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    selectedCompressLevel = btn.dataset.level;
    document.querySelectorAll(".compress-level-btn").forEach((b) => b.classList.toggle("active", b === btn));
  });
});

let compressState = null; // { file }

function updateCompressPanel() {
  compressLockedNotice.classList.toggle("hidden", isPaid);
  compressDropzone.style.opacity = isPaid ? "1" : "0.5";
  compressDropzone.style.pointerEvents = isPaid ? "auto" : "none";
  document.getElementById("compressLevelSelector").style.opacity = isPaid ? "1" : "0.5";
  document.getElementById("compressLevelSelector").style.pointerEvents = isPaid ? "auto" : "none";
  compressBtnText.textContent = compressState ? "Compress and Download" : "Choose a PDF first";
}

compressFileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) loadCompressFile(file);
  compressFileInput.value = "";
});
["dragenter", "dragover"].forEach((evt) =>
  compressDropzone.addEventListener(evt, (e) => { e.preventDefault(); if (isPaid) compressDropzone.classList.add("dragover"); })
);
["dragleave", "drop"].forEach((evt) =>
  compressDropzone.addEventListener(evt, (e) => { e.preventDefault(); compressDropzone.classList.remove("dragover"); })
);
compressDropzone.addEventListener("drop", (e) => {
  if (!isPaid) return;
  const file = (e.dataTransfer.files || [])[0];
  if (file) loadCompressFile(file);
});

function loadCompressFile(file) {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    setStatus("Please select a valid PDF file.", "error");
    return;
  }
  compressState = { file };
  compressResult.classList.add("hidden");
  compressBtn.disabled = false;
  compressBtnText.textContent = `Compress: ${file.name}`;
  setStatus("");
}

compressBtn.addEventListener("click", async () => {
  if (!isPaid) {
    extpay.openPaymentPage();
    return;
  }
  if (!compressState) return;

  compressBtn.disabled = true;

  try {
    const arrayBuffer = await compressState.file.arrayBuffer();
    const originalSize = arrayBuffer.byteLength;

    const pdf = await PDFDocument.load(arrayBuffer, { updateMetadata: false });

    // Strip metadata — takes up unnecessary space in some PDFs
    pdf.setTitle("");
    pdf.setAuthor("");
    pdf.setSubject("");
    pdf.setKeywords([]);
    pdf.setProducer("");
    pdf.setCreator("");

    // Real size reduction mostly comes from re-encoding embedded images —
    // metadata cleanup alone barely moves the needle for most PDFs.
    const levelSettings = COMPRESS_LEVELS[selectedCompressLevel];
    const stats = await recompressEmbeddedImages(pdf, levelSettings, (msg) => setStatus(msg, ""));

    const compressedBytes = await pdf.save({ useObjectStreams: true });
    const newSize = compressedBytes.byteLength;

    await downloadBlob(compressedBytes, "compressed.pdf");

    compressResult.classList.remove("hidden");
    compressBefore.textContent = formatSize(originalSize);
    compressAfter.textContent = formatSize(newSize);

    const totalImagesFound = stats.dct + stats.flate + stats.unsupported;

    if (newSize < originalSize) {
      const pct = Math.round((1 - newSize / originalSize) * 100);
      compressSavings.textContent = `${pct}% smaller`;
      setStatus(`✓ Compressed — ${pct}% smaller (${stats.recompressed}/${totalImagesFound} images re-encoded).`, "success");
    } else if (totalImagesFound === 0) {
      compressSavings.textContent = "No images found";
      setStatus("This PDF has no embedded images to recompress — text-only PDFs are already compact.", "");
    } else if (stats.recompressed === 0 && stats.unsupported > 0) {
      compressSavings.textContent = "Unsupported image format";
      const formats = Array.from(stats.unsupportedFilters).join(", ");
      setStatus(`Found ${totalImagesFound} image(s), but they use a format we can't recompress yet (${formats}). No changes made.`, "error");
    } else {
      compressSavings.textContent = "Already optimized";
      setStatus(`This file's images are already well-optimized (checked ${totalImagesFound}, none could be shrunk further).`, "");
    }
  } catch (err) {
    console.error(err);
    setStatus("Error: the file couldn't be compressed. Please try again.", "error");
  } finally {
    compressBtn.disabled = false;
  }
});

// Finds embedded images inside the PDF and re-encodes them as smaller JPEGs.
// Handles the two dominant embedding formats:
//   - DCTDecode: already a JPEG — just decode/resize/re-encode.
//   - FlateDecode: a raw (losslessly compressed) pixel bitmap, common from
//     PNG-based scanners/exports — decoded to raw pixels, drawn to a canvas,
//     then re-encoded as JPEG (usually the biggest win, since raw bitmaps
//     are much larger than an equivalent JPEG).
// CCITTFaxDecode/JBIG2Decode (1-bit fax-style scans) and other exotic
// formats are detected and reported, but intentionally left untouched —
// they're already extremely compact and re-encoding them as JPEG would
// typically make them LARGER, not smaller.
async function recompressEmbeddedImages(pdf, levelSettings, onProgress) {
  const { PDFName, PDFArray, PDFRawStream, decodePDFRawStream } = PDFLib;
  const context = pdf.context;
  const entries = context.enumerateIndirectObjects();

  const stats = { dct: 0, flate: 0, unsupported: 0, recompressed: 0, unsupportedFilters: new Set() };

  function getFilterName(dict) {
    const filter = dict.lookup(PDFName.of("Filter"));
    if (!filter) return null;
    if (filter instanceof PDFArray) {
      const size = filter.size();
      return size > 0 ? filter.lookup(size - 1, PDFName).encodedName : null;
    }
    return filter.encodedName;
  }

  async function bitmapFromRawPixels(dict, rawBytes, width, height) {
    const bpc = dict.lookup(PDFName.of("BitsPerComponent"));
    const bitsPerComponent = bpc ? bpc.asNumber() : 8;
    const colorSpace = dict.lookup(PDFName.of("ColorSpace"));
    const csName = colorSpace && colorSpace.encodedName;

    if (bitsPerComponent !== 8) return null;
    if (csName !== "/DeviceRGB" && csName !== "/DeviceGray" && csName !== "/DeviceCMYK") return null;

    const rgba = new Uint8ClampedArray(width * height * 4);

    if (csName === "/DeviceGray") {
      for (let i = 0, p = 0; i < rawBytes.length; i++, p += 4) {
        const g = rawBytes[i];
        rgba[p] = g; rgba[p + 1] = g; rgba[p + 2] = g; rgba[p + 3] = 255;
      }
    } else if (csName === "/DeviceRGB") {
      for (let i = 0, p = 0; i + 2 < rawBytes.length; i += 3, p += 4) {
        rgba[p] = rawBytes[i]; rgba[p + 1] = rawBytes[i + 1]; rgba[p + 2] = rawBytes[i + 2]; rgba[p + 3] = 255;
      }
    } else if (csName === "/DeviceCMYK") {
      for (let i = 0, p = 0; i + 3 < rawBytes.length; i += 4, p += 4) {
        const c = rawBytes[i] / 255, m = rawBytes[i + 1] / 255, y = rawBytes[i + 2] / 255, k = rawBytes[i + 3] / 255;
        rgba[p] = 255 * (1 - c) * (1 - k);
        rgba[p + 1] = 255 * (1 - m) * (1 - k);
        rgba[p + 2] = 255 * (1 - y) * (1 - k);
        rgba[p + 3] = 255;
      }
    }

    const imageData = new ImageData(rgba, width, height);
    const bitmapCanvas = new OffscreenCanvas(width, height);
    bitmapCanvas.getContext("2d").putImageData(imageData, 0, 0);
    return createImageBitmap(bitmapCanvas);
  }

  // Tries progressively more aggressive settings (lower quality, then also
  // a smaller max dimension) until the re-encoded JPEG is actually smaller
  // than the original — guarantees a real result instead of silently giving
  // up on images that were already JPEG-compressed at a similar quality.
  async function encodeUntilSmaller(bitmap, originalByteLength, settings) {
    const { width, height } = bitmap;
    if (width <= 0 || height <= 0) return null;

    const attempts = [
      { maxDimension: settings.maxDimension, quality: settings.quality },
      { maxDimension: settings.maxDimension, quality: settings.minQuality },
      { maxDimension: Math.round(settings.maxDimension * 0.7), quality: settings.minQuality },
      { maxDimension: Math.round(settings.maxDimension * 0.5), quality: Math.max(0.12, settings.minQuality - 0.1) },
    ];

    let best = null;

    for (const attempt of attempts) {
      const scale = Math.min(1, attempt.maxDimension / Math.max(width, height));
      const targetW = Math.max(1, Math.round(width * scale));
      const targetH = Math.max(1, Math.round(height * scale));

      const canvas = new OffscreenCanvas(targetW, targetH);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);

      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: attempt.quality });
      const bytes = new Uint8Array(await blob.arrayBuffer());

      if (!best || bytes.byteLength < best.bytes.byteLength) {
        best = { bytes, width: targetW, height: targetH };
      }
      if (bytes.byteLength < originalByteLength) {
        return best; // good enough — stop escalating
      }
    }

    // Even our most aggressive attempt didn't beat the original — return
    // the smallest one we found (caller decides whether to use it).
    return best;
  }

  for (const [ref, obj] of entries) {
    if (!(obj instanceof PDFRawStream)) continue;

    const dict = obj.dict;
    const subtype = dict.lookup(PDFName.of("Subtype"));
    if (!subtype || subtype.encodedName !== "/Image") continue;

    const filterName = getFilterName(dict);
    const originalBytes = obj.getContents();

    let bitmap = null;

    try {
      if (filterName === "/DCTDecode") {
        stats.dct++;
        onProgress(`Compressing image ${stats.dct + stats.flate}...`);
        const blob = new Blob([originalBytes], { type: "image/jpeg" });
        bitmap = await createImageBitmap(blob);
      } else if (filterName === "/FlateDecode" || filterName === null) {
        const width = dict.lookup(PDFName.of("Width"))?.asNumber();
        const height = dict.lookup(PDFName.of("Height"))?.asNumber();
        if (!width || !height) continue;

        const decoded = decodePDFRawStream({ dict, contents: originalBytes }).decode();
        const built = await bitmapFromRawPixels(dict, decoded, width, height);
        if (!built) {
          stats.unsupported++;
          stats.unsupportedFilters.add("raw bitmap (unsupported color space)");
          continue;
        }
        stats.flate++;
        onProgress(`Compressing image ${stats.dct + stats.flate}...`);
        bitmap = built;
      } else {
        stats.unsupported++;
        stats.unsupportedFilters.add(filterName || "unknown");
        continue;
      }

      const result = await encodeUntilSmaller(bitmap, originalBytes.byteLength, levelSettings);
      bitmap.close();
      if (!result || result.bytes.byteLength >= originalBytes.byteLength) continue;

      const newDict = context.obj({
        Type: "XObject",
        Subtype: "Image",
        Width: result.width,
        Height: result.height,
        ColorSpace: "DeviceRGB",
        BitsPerComponent: 8,
        Filter: "DCTDecode",
      });
      context.assign(ref, PDFRawStream.of(newDict, result.bytes));
      stats.recompressed++;
    } catch (imgErr) {
      console.warn("Skipped an image during compression:", filterName, imgErr);
      stats.unsupported++;
      stats.unsupportedFilters.add(`${filterName || "unknown"} (decode error)`);
    }
  }

  return stats;
}

// ============================================================
// Init
// ============================================================

updateMergeButtonState();
updateSplitButtonState();
updateCompressPanel();

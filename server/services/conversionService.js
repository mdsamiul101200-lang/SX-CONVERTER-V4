const path = require("path");
const fs = require("fs-extra");
const { execFile } = require("child_process");
const { promisify } = require("util");
const exec = promisify(execFile);

const EXT = { PDF: "pdf", HTML: "html", APK: "apk", ZIP: "zip", DOCX: "docx", TXT: "txt" };
const TIMEOUT = Number(process.env.JOB_TIMEOUT_MS || 300000);

async function command(name, args, options = {}) {
  return exec(name, args, { timeout: TIMEOUT, maxBuffer: 16 * 1024 * 1024, ...options });
}
function safeName(s) { return String(s).replace(/[^\w.\-]+/g, "_").slice(0, 120) || "output"; }
function done(out, job) {
  job.progress = 95;
  job.message = "Validating output...";
  return { outputPath: out, outputName: `SX-CONVERTER-${job.jobId}.${EXT[job.outputFormat]}` };
}

async function convert({ job, inputPath, outputDir, tmpDir }) {
  const out = path.join(outputDir, `sx_${job.jobId}.${EXT[job.outputFormat]}`);
  const work = path.join(tmpDir, job.jobId);
  await fs.ensureDir(work);
  const i = job.inputFormat, o = job.outputFormat;
  job.progress = 20;
  job.message = `Validating ${i} input...`;
  await validateInput(inputPath, i);
  job.progress = 28;
  job.message = `Converting ${i} → ${o}...`;

  if (i === o) throw new Error("Input and output formats must be different.");

  // Direct/document conversions.
  if (i === "HTML") {
    if (o === "TXT") return htmlToTxt(inputPath, out, job);
    if (o === "PDF") return libreOffice(inputPath, out, "pdf", job);
    if (o === "DOCX") { const text = await extractHtmlText(inputPath); return createDocxFromText(text, out, work, job); }
    if (o === "ZIP") return zipSingle(inputPath, out, work, job);
    if (o === "APK") return buildApkFromHtml(inputPath, out, work, job);
  }
  if (i === "TXT") {
    if (o === "HTML") return txtToHtml(inputPath, out, job);
    if (o === "PDF") return libreOffice(inputPath, out, "pdf", job);
    if (o === "DOCX") return createDocxFromText(await fs.readFile(inputPath, "utf8"), out, work, job);
    if (o === "ZIP") return zipSingle(inputPath, out, work, job);
    if (o === "APK") {
      const html = path.join(work, "index.html");
      await txtToHtml(inputPath, html, job);
      return buildWebViewApk(path.dirname(html), out, work, job);
    }
  }
  if (i === "DOCX") {
    if (o === "TXT" || o === "HTML" || o === "PDF") return libreOffice(inputPath, out, EXT[o], job);
    if (o === "ZIP") return zipSingle(inputPath, out, work, job);
    if (o === "APK") {
      const html = path.join(work, "converted.html");
      await libreOffice(inputPath, html, "html", job);
      return buildWebViewApk(path.dirname(html), out, work, job);
    }
  }
  if (i === "PDF") {
    if (o === "TXT") return pdfToTxt(inputPath, out, job);
    if (o === "HTML") return pdfToHtml(inputPath, out, job);
    if (o === "DOCX") {
      const textFile = path.join(work, "converted.txt");
      await pdfToTxt(inputPath, textFile, job);
      const text = await fs.readFile(textFile, "utf8");
      return createDocxFromText(text, out, work, job);
    }
    if (o === "ZIP") return zipSingle(inputPath, out, work, job);
    if (o === "APK") {
      const html = path.join(work, "converted.html");
      await pdfToHtml(inputPath, html, job);
      return buildWebViewApk(path.dirname(html), out, work, job);
    }
  }
  if (i === "ZIP") {
    await safeExtract(inputPath, work);
    const html = findFile(work, ["index.html", ".html", ".htm"]);
    const txt = findFile(work, [".txt"]);
    if (o === "ZIP") throw new Error("Input and output formats must be different.");
    if (o === "HTML") {
      if (!html) throw new Error("ZIP contains no recoverable HTML document.");
      await fs.copy(html, out); return done(out, job);
    }
    if (o === "APK") {
      if (!html) throw new Error("ZIP contains no recoverable HTML site for Android WebView packaging.");
      return buildWebViewApk(path.dirname(html), out, work, job);
    }
    if (html) {
      if (o === "TXT") return htmlToTxt(html, out, job);
      if (o === "PDF") return libreOffice(html, out, "pdf", job);
      if (o === "DOCX") return createDocxFromText(await extractHtmlText(html), out, work, job);
    }
    if (txt) {
      if (o === "TXT") { await fs.copy(txt, out); return done(out, job); }
      if (o === "PDF") return libreOffice(txt, out, "pdf", job);
      if (o === "DOCX") return createDocxFromText(await fs.readFile(txt, "utf8"), out, work, job);
    }
    throw new Error("ZIP contains no supported HTML or TXT source content.");
  }
  if (i === "APK") {
    await safeExtract(inputPath, work);
    if (o === "ZIP") return zipSingle(inputPath, out, work, job);
    const html = findFile(work, ["index.html", ".html", ".htm"]);
    if (!html) throw new Error("APK contains no recoverable HTML/WebView content.");
    if (o === "HTML") { await fs.copy(html, out); return done(out, job); }
    if (o === "TXT") return htmlToTxt(html, out, job);
    if (o === "PDF") return libreOffice(html, out, "pdf", job);
      if (o === "DOCX") return createDocxFromText(await extractHtmlText(html), out, work, job);
  }
  throw new Error(`No genuine conversion pipeline is available for ${i} → ${o}.`);
}

async function validateInput(input, format) {
  const head = await fs.readFile(input, { encoding: null, flag: "r" });
  const sample = head.subarray(0, Math.min(head.length, 4096));
  if (format === "PDF" && sample.subarray(0, 5).toString() !== "%PDF-") throw new Error("Selected input format is PDF, but the uploaded file is not a valid PDF.");
  if (format === "ZIP" || format === "APK") {
    if (sample[0] !== 0x50 || sample[1] !== 0x4b) throw new Error(`Selected input format is ${format}, but the uploaded file is not a valid ZIP/APK archive.`);
    await command("unzip", ["-t", input]);
  }
  if (format === "DOCX") {
    if (sample[0] !== 0x50 || sample[1] !== 0x4b) throw new Error("Selected input format is DOCX, but the uploaded file is not a valid DOCX archive.");
    await command("unzip", ["-t", input]);
  }
  if (format === "HTML" && !/<(?:!doctype\s+html|html|body|head)\b/i.test(sample.toString("utf8"))) throw new Error("Selected input format is HTML, but no HTML structure was detected.");
  if (format === "TXT" && sample.includes(0x00)) throw new Error("Selected input format is TXT, but the file contains binary data.");
}

async function htmlToTxt(input, out, job) {
  const s = await fs.readFile(input, "utf8");
  const t = s.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
  if (!t) throw new Error("HTML contains no recoverable text.");
  await fs.writeFile(out, t + "\n"); return done(out, job);
}
async function extractHtmlText(input) {
  const s = await fs.readFile(input, "utf8");
  const t = s.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\s+/g, " ").trim();
  if (!t) throw new Error("HTML contains no recoverable text.");
  return t;
}
function xmlEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
async function createDocxFromText(text, out, work, job) {
  const dir = path.join(work, "docx");
  await fs.remove(dir); await fs.ensureDir(path.join(dir, "_rels")); await fs.ensureDir(path.join(dir, "word", "_rels"));
  const paragraphs = String(text).replace(/\r/g, "").split("\n").map(line => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r></w:p>`).join("");
  await fs.writeFile(path.join(dir, "[Content_Types].xml"), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
  await fs.writeFile(path.join(dir, "_rels/.rels"), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  await fs.writeFile(path.join(dir, "word/_rels/document.xml.rels"), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`);
  await fs.writeFile(path.join(dir, "word/styles.xml"), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style></w:styles>`);
  await fs.writeFile(path.join(dir, "word/document.xml"), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`);
  await command("zip", ["-qr", out, "."], { cwd: dir });
  return done(out, job);
}

async function txtToHtml(input, out, job) {
  const s = await fs.readFile(input, "utf8");
  const esc = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  await fs.writeFile(out, `<!doctype html><html><head><meta charset="utf-8"><title>SX CONVERTER</title></head><body><pre>${esc}</pre></body></html>`, "utf8");
  return done(out, job);
}
async function libreOffice(input, out, format, job) {
  const dir = path.dirname(out); const temp = path.join(dir, `lo_${job.jobId}_${format}`); await fs.ensureDir(temp);
  const filter = format === "docx" ? "docx:Office Open XML Text" : format === "html" ? "html:XHTML Writer File" : format === "pdf" ? "pdf:writer_pdf_Export" : "txt:Text";
  await command("libreoffice", ["--headless", "--convert-to", filter, "--outdir", temp, input]);
  const expected = path.basename(input, path.extname(input)) + "." + format;
  let candidate = path.join(temp, expected);
  if (!(await fs.pathExists(candidate))) {
    const f = (await fs.readdir(temp)).find(x => x.toLowerCase().endsWith("." + format));
    if (!f) throw new Error(`LibreOffice did not produce a valid ${format.toUpperCase()} output.`);
    candidate = path.join(temp, f);
  }
  await fs.copy(candidate, out); return done(out, job);
}
async function pdfToTxt(input, out, job) {
  await command("pdftotext", ["-enc", "UTF-8", input, out]);
  const s = await fs.readFile(out, "utf8"); if (!s.trim()) throw new Error("PDF contains no extractable text.");
  return done(out, job);
}
async function pdfToHtml(input, out, job) {
  await command("pdftotext", ["-htmlmeta", "-enc", "UTF-8", input, out]);
  const s = await fs.readFile(out, "utf8"); if (!s.trim()) throw new Error("PDF contains no extractable text.");
  return done(out, job);
}
async function zipSingle(input, out, work, job) {
  const dir = path.join(work, "zipout"); await fs.ensureDir(dir);
  await fs.copy(input, path.join(dir, safeName(path.basename(input))));
  await command("zip", ["-qr", out, "."], { cwd: dir });
  return done(out, job);
}
async function safeExtract(input, dir) {
  const listing = (await command("unzip", ["-Z1", input])).stdout.split(/\r?\n/).filter(Boolean);
  if (listing.length > 5000) throw new Error("Archive contains too many entries.");
  let total = 0;
  for (const name of listing) {
    const n = name.replace(/\\/g, "/");
    const normalized = path.posix.normalize(n);
    if (normalized.startsWith("../") || normalized.startsWith("/") || normalized.includes("/../")) throw new Error("Unsafe archive path detected.");
  }
  const info = (await command("unzip", ["-l", input])).stdout;
  for (const line of info.split(/\r?\n/)) {
    const m = line.match(/^\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+(\d+)\s+/);
    if (m) { total += Number(m[1]); if (total > 300 * 1024 * 1024) throw new Error("Archive expands beyond the 300 MB safety limit."); }
  }
  await fs.ensureDir(dir);
  await command("unzip", ["-q", input, "-d", dir]);
}
function findFile(root, endings) {
  const stack = [root]; let any = null;
  while (stack.length) {
    const d = stack.pop();
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name); const st = fs.statSync(p);
      if (st.isDirectory()) stack.push(p);
      else {
        const low = name.toLowerCase();
        if (low === "index.html") return p;
        if (!any && endings.some(e => low.endsWith(e))) any = p;
      }
    }
  }
  return any;
}

async function buildApkFromHtml(input, out, work, job) {
  const html = await fs.readFile(input, "utf8");
  if (!/<(?:!doctype\s+html|html)\b/i.test(html)) throw new Error("Input is not recognizable HTML.");
  const site = path.join(work, "site"); await fs.ensureDir(site); await fs.writeFile(path.join(site, "index.html"), html);
  return buildWebViewApk(site, out, work, job);
}
async function buildWebViewApk(siteDir, out, work, job) {
  const project = path.join(work, "android");
  await fs.ensureDir(path.join(project, "app/src/main/assets"));
  await fs.ensureDir(path.join(project, "app/src/main/java/com/sxconverter/app"));
  await fs.ensureDir(path.join(project, "app/src/main/res/values"));
  await fs.writeFile(path.join(project, "settings.gradle"), `pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }\ndependencyResolutionManagement { repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS); repositories { google(); mavenCentral() } }\nrootProject.name="SXConverterBuild"\ninclude(":app")`);
  await fs.writeFile(path.join(project, "build.gradle"), `plugins { id "com.android.application" version "8.6.1" apply false }`);
  await fs.writeFile(path.join(project, "app/build.gradle"), `plugins { id "com.android.application" }\nandroid { namespace "com.sxconverter.app"; compileSdk 35; defaultConfig { applicationId "com.sxconverter.generated"; minSdk 23; targetSdk 35; versionCode 1; versionName "1.0" } }`);
  await fs.writeFile(path.join(project, "app/src/main/AndroidManifest.xml"), `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><uses-permission android:name="android.permission.INTERNET"/><application android:theme="@style/AppTheme" android:label="SX CONVERTER"><activity android:name=".MainActivity" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>`);
  await fs.writeFile(path.join(project, "app/src/main/res/values/styles.xml"), `<resources><style name="AppTheme" parent="android:style/Theme.Material.Light.NoActionBar"><item name="android:fontFamily">sans</item><item name="android:colorAccent">#35C8FF</item></style></resources>`);
  await fs.writeFile(path.join(project, "app/src/main/java/com/sxconverter/app/MainActivity.java"), `package com.sxconverter.app;\nimport android.app.Activity; import android.os.Bundle; import android.webkit.WebView;\npublic class MainActivity extends Activity { public void onCreate(Bundle b){ super.onCreate(b); WebView w=new WebView(this); w.getSettings().setJavaScriptEnabled(true); w.getSettings().setDomStorageEnabled(true); w.loadUrl("file:///android_asset/index.html"); setContentView(w); } }`);
  await fs.copy(siteDir, path.join(project, "app/src/main/assets"));
  job.progress = 60; job.message = "Building a real Android APK...";
  await command("gradle", ["--no-daemon", "--stacktrace", "assembleDebug"], { cwd: project });
  const built = path.join(project, "app/build/outputs/apk/debug/app-debug.apk");
  if (!(await fs.pathExists(built))) throw new Error("Gradle finished without producing an APK.");
  await command("unzip", ["-t", built]);
  const entries = (await command("unzip", ["-Z1", built])).stdout.split(/\r?\n/);
  if (!entries.includes("AndroidManifest.xml") || !entries.some(x => /^classes\d*\.dex$/.test(x))) throw new Error("Generated APK failed structural validation.");
  await fs.copy(built, out); return done(out, job);
}
module.exports = { convert };

const API_BASE_URL = window.SX_API_BASE_URL || "";

const $ = id => document.getElementById(id);
const fileInput = $("fileInput"), uploadZone = $("uploadZone"), chooseBtn = $("chooseBtn");
const selectedFile = $("selectedFile"), pasteBox = $("pasteBox"), pasteArea = $("pasteArea");
const inputFormat = $("inputFormat"), outputFormat = $("outputFormat"), convertBtn = $("convertBtn");
const status = $("status"), result = $("result"), errorBox = $("error"), progressBar = $("progressBar");

let currentFile = null;
let currentJob = null;

const formats = ["PDF","HTML","APK","ZIP","DOCX","TXT"];
const extMap = {PDF:"pdf",HTML:"html",APK:"apk",ZIP:"zip",DOCX:"docx",TXT:"txt"};

function api(path){ return `${API_BASE_URL}${path}`; }
function show(el){el.classList.remove("hidden")} function hide(el){el.classList.add("hidden")}
function setError(msg){ errorBox.textContent = msg; show(errorBox); }
function clearError(){ hide(errorBox); errorBox.textContent=""; }

function populateFormats(){
  for(const select of [inputFormat,outputFormat]){
    select.innerHTML = formats.map(f=>`<option value="${f}">${f}</option>`).join("");
  }
  inputFormat.value="HTML"; outputFormat.value="APK";
}
populateFormats();

chooseBtn.onclick = () => fileInput.click();
uploadZone.onclick = e => { if(!e.target.closest("button")) fileInput.click(); };
fileInput.onchange = () => { if(fileInput.files[0]) setFile(fileInput.files[0]); };

["dragenter","dragover"].forEach(ev=>uploadZone.addEventListener(ev,e=>{e.preventDefault();uploadZone.classList.add("drag")}));
["dragleave","drop"].forEach(ev=>uploadZone.addEventListener(ev,e=>{e.preventDefault();uploadZone.classList.remove("drag")}));
uploadZone.addEventListener("drop",e=>{const f=e.dataTransfer.files[0]; if(f)setFile(f)});

function setFile(f){
  currentFile=f; clearError(); hide(pasteBox); show(selectedFile);
  $("fileName").textContent=f.name;
  $("fileInfo").textContent=`${f.type || "unknown"} • ${formatBytes(f.size)}`;
}
function formatBytes(n){ if(n<1024)return `${n} B`; if(n<1048576)return `${(n/1024).toFixed(1)} KB`; return `${(n/1048576).toFixed(2)} MB`; }

$("removeBtn").onclick=()=>{currentFile=null;fileInput.value="";hide(selectedFile)};
$("pasteBtn").onclick=()=>{hide(selectedFile);show(pasteBox);pasteArea.focus()};
$("cancelPasteBtn").onclick=()=>hide(pasteBox);
$("usePasteBtn").onclick=()=>{
  const text=pasteArea.value;
  if(!text.trim()) return setError("Paste content is empty.");
  const type=inputFormat.value==="HTML"?"text/html":"text/plain";
  const ext=extMap[inputFormat.value];
  currentFile=new File([text],`pasted-content.${ext}`,{type});
  $("fileName").textContent=currentFile.name;
  $("fileInfo").textContent=`pasted content • ${formatBytes(currentFile.size)}`;
  hide(pasteBox);show(selectedFile);clearError();
};

function setProgress(n,detail){
  progressBar.style.width=`${Math.max(5,Math.min(100,n))}%`;
  $("statusDetail").textContent=detail;
}
async function upload(){
  const fd=new FormData();
  fd.append("file",currentFile);
  const r=await fetch(api("/api/upload"),{method:"POST",body:fd});
  const data=await r.json();
  if(!r.ok) throw new Error(data.error||"Upload failed.");
  return data;
}
async function convert(){
  clearError();
  if(!currentFile) return setError("Choose a file first.");
  if(!inputFormat.value||!outputFormat.value) return setError("Select both formats.");
  if(inputFormat.value===outputFormat.value) return setError("Input and output formats are identical. Choose a different output format.");
  convertBtn.disabled=true; $("convertLabel").textContent="PROCESSING"; show($("spinner")); hide(result); show(status); setProgress(8,"Uploading file...");
  try{
    const up=await upload();
    setProgress(25,"Starting conversion...");
    const r=await fetch(api("/api/convert"),{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({fileId:up.fileId,inputFormat:inputFormat.value,outputFormat:outputFormat.value})
    });
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||"Conversion could not be started.");
    currentJob=data.jobId;
    await poll();
  }catch(e){
    hide(status); setError(e.message||"CONVERSION FAILED");
  }finally{
    convertBtn.disabled=false; $("convertLabel").textContent="CONVERT"; hide($("spinner"));
  }
}
async function poll(){
  for(let i=0;i<120;i++){
    const r=await fetch(api(`/api/conversion/${currentJob}`)); const data=await r.json();
    if(!r.ok) throw new Error(data.error||"Job lookup failed.");
    if(data.status==="PROCESSING") setProgress(data.progress||35,data.message||"Processing...");
    if(data.status==="QUEUED") setProgress(12,"Queued...");
    if(data.status==="COMPLETED"){
      setProgress(100,"Output validated and ready.");
      hide(status); $("resultFile").textContent=data.outputName; show(result);
      $("downloadBtn").onclick=()=>window.location.href=api(`/api/download/${currentJob}`);
      return;
    }
    if(data.status==="FAILED") throw new Error(data.error||"CONVERSION FAILED");
    await new Promise(r=>setTimeout(r,1000));
  }
  throw new Error("Conversion timed out.");
}
convertBtn.onclick=convert;
$("againBtn").onclick=()=>{hide(result);clearError();};

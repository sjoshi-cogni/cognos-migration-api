const API_BASE = 'http://localhost:8000/api/v1';

async function apiPost(path, formData) {
  const res = await fetch(API_BASE + path, { method: 'POST', body: formData });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function apiDownloadBlob(path, formData) {
  const res = await fetch(API_BASE + path, { method: 'POST', body: formData });
  if (!res.ok) throw new Error(await res.text());
  return res.blob();
}

async function apiDownload(path, formData, filename) {
  const res = await fetch(API_BASE + path, { method: 'POST', body: formData });
  if (!res.ok) throw new Error(await res.text());
  const blob = await res.blob();
  downloadBlob(blob, filename);
}

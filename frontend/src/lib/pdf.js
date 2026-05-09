/**
 * Convert a base64 string to a Blob URL for reliable PDF embed.
 * data: URLs become unreliable / blocked above ~2MB in many browsers.
 */
export function base64ToBlobUrl(b64, mimeType = "application/pdf") {
  if (!b64) return null;
  try {
    const byteChars = atob(b64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeType });
    return URL.createObjectURL(blob);
  } catch (e) {
    console.error("base64ToBlobUrl failed", e);
    return null;
  }
}

export function revokeBlobUrl(url) {
  if (url && url.startsWith("blob:")) {
    try { URL.revokeObjectURL(url); } catch {}
  }
}

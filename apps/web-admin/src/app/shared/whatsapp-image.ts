import type { WhatsAppImageInput } from "@barber/shared/whatsapp";

/** Longest side of a photo sent on WhatsApp: WhatsApp itself downsizes to about this. */
const MAX_SIDE = 1600;
/** Kept small so the pending send survives a reload (stored in the tab). */
const MAX_DATA_URL = 3_000_000;

/**
 * Photo chosen from the device → JPEG ready for WhatsApp.
 * Re-encoding also removes location and camera data from the file.
 */
export async function prepareWhatsAppImage(file: File): Promise<WhatsAppImageInput> {
  if (!file.type.startsWith("image/")) throw new Error("Scegli una foto (JPG, PNG o WebP).");
  const bitmap = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Il browser non riesce a preparare la foto.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let quality = 0.85, data = canvas.toDataURL("image/jpeg", quality);
  while (data.length > MAX_DATA_URL && quality > 0.5) {
    quality -= 0.1;
    data = canvas.toDataURL("image/jpeg", quality);
  }
  if (data.length > MAX_DATA_URL) throw new Error("La foto è troppo grande. Scegline una più leggera.");
  const base = file.name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_").slice(0, 80) || "foto";
  return { data, filename: `${base}.jpg` };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Formato della foto non leggibile da questo browser. Prova con una foto JPG o PNG."));
    };
    image.src = url;
  });
}

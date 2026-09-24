export function parseAppointmentOrderSseFrame(frame: string): any[] | null {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return null;

  try {
    const payload = JSON.parse(data) as { appointments?: any[] };
    return Array.isArray(payload.appointments) ? payload.appointments : [];
  } catch {
    return null;
  }
}

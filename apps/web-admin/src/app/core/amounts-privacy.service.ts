import { Injectable, signal } from "@angular/core";

const STORAGE_KEY = "barber.balance-hidden";

/**
 * «Nascondi gli importi»: a preference of this device (e.g. the shop screen
 * that clients can see), set in Profilo › Preferenze di questo dispositivo.
 */
@Injectable({ providedIn: "root" })
export class AmountsPrivacyService {
  readonly hidden = signal(read());

  set(hidden: boolean): void {
    this.hidden.set(hidden);
    try {
      window.localStorage.setItem(STORAGE_KEY, hidden ? "1" : "0");
    } catch {
      // Storage can be unavailable (private mode): it still applies until reload.
    }
  }
}

function read(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export type StopObserving = () => void;

export type UpdateReloadQueueOptions = {
  hasOpenModal: () => boolean;
  observeModalChanges: (onChange: () => void) => StopObserving;
  beforeReload: () => Promise<void>;
  reload: () => void;
};

/**
 * Accoda un aggiornamento dell'app finche tutti i dialoghi modali sono chiusi.
 * Richieste ripetute durante l'attesa producono comunque un solo refresh.
 */
export class UpdateReloadQueue {
  private pending = false;
  private preparing = false;
  private prepared = false;
  private reloading = false;
  private stopObserving: StopObserving | null = null;

  constructor(private readonly options: UpdateReloadQueueOptions) {}

  request(): void {
    if (this.reloading) {
      return;
    }

    this.pending = true;
    this.flushWhenSafe();
  }

  private flushWhenSafe = (): void => {
    if (!this.pending || this.preparing || this.reloading) {
      return;
    }

    if (this.options.hasOpenModal()) {
      // Se il modale si e aperto durante la preparazione, ripeteremo la pulizia
      // delle cache dopo la sua chiusura per mantenere atomica la procedura.
      this.prepared = false;
      this.stopObserving ??= this.options.observeModalChanges(
        this.flushWhenSafe,
      );
      return;
    }

    this.stopObserving?.();
    this.stopObserving = null;

    if (!this.prepared) {
      this.pending = false;
      this.preparing = true;
      void this.options.beforeReload().then(
        () => {
          this.preparing = false;
          this.prepared = true;
          this.pending = true;
          this.flushWhenSafe();
        },
        () => {
          // Un prossimo controllo versione potra ritentare la preparazione.
          this.preparing = false;
        },
      );
      return;
    }

    this.pending = false;
    this.reloading = true;
    this.options.reload();
  };
}

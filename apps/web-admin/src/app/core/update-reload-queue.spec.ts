import { UpdateReloadQueue } from "./update-reload-queue";

describe("UpdateReloadQueue", () => {
  it("prepara e ricarica subito quando non ci sono modali aperte", async () => {
    const reload = jest.fn();
    const observeModalChanges = jest.fn();
    const beforeReload = jest.fn().mockResolvedValue(undefined);
    const queue = new UpdateReloadQueue({
      hasOpenModal: () => false,
      observeModalChanges,
      beforeReload,
      reload,
    });

    queue.request();
    await Promise.resolve();

    expect(beforeReload).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(observeModalChanges).not.toHaveBeenCalled();
  });

  it("attende la chiusura dell'ultimo modale prima di preparare e ricaricare", async () => {
    let modalOpen = true;
    let onModalChange: (() => void) | undefined;
    const stopObserving = jest.fn();
    const reload = jest.fn();
    const queue = new UpdateReloadQueue({
      hasOpenModal: () => modalOpen,
      observeModalChanges: (onChange) => {
        onModalChange = onChange;
        return stopObserving;
      },
      beforeReload: () => Promise.resolve(),
      reload,
    });

    queue.request();
    expect(reload).not.toHaveBeenCalled();

    modalOpen = false;
    onModalChange?.();
    await Promise.resolve();

    expect(stopObserving).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("mantiene un solo observer e un solo refresh per richieste ripetute", async () => {
    let modalOpen = true;
    let onModalChange: (() => void) | undefined;
    const reload = jest.fn();
    const observeModalChanges = jest.fn((onChange: () => void) => {
      onModalChange = onChange;
      return jest.fn();
    });
    const queue = new UpdateReloadQueue({
      hasOpenModal: () => modalOpen,
      observeModalChanges,
      beforeReload: () => Promise.resolve(),
      reload,
    });

    queue.request();
    queue.request();
    expect(observeModalChanges).toHaveBeenCalledTimes(1);

    modalOpen = false;
    onModalChange?.();
    await Promise.resolve();
    queue.request();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("torna in attesa se un modale si apre durante la preparazione", async () => {
    let modalOpen = false;
    let onModalChange: (() => void) | undefined;
    let finishPreparation: (() => void) | undefined;
    let preparationCount = 0;
    const reload = jest.fn();
    const beforeReload = jest.fn(() => {
      preparationCount += 1;
      if (preparationCount > 1) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        finishPreparation = resolve;
      });
    });
    const queue = new UpdateReloadQueue({
      hasOpenModal: () => modalOpen,
      observeModalChanges: (onChange) => {
        onModalChange = onChange;
        return jest.fn();
      },
      beforeReload,
      reload,
    });

    queue.request();
    modalOpen = true;
    finishPreparation?.();
    await Promise.resolve();

    expect(reload).not.toHaveBeenCalled();

    modalOpen = false;
    onModalChange?.();
    await Promise.resolve();

    expect(beforeReload).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

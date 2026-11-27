jest.mock("@angular/core", () => ({
  Injectable: () => (target: unknown) => target,
  inject: () => ({}),
  signal: (initial: unknown) => Object.assign(() => initial, { set: () => undefined }),
}));
jest.mock("./whatsapp-api.service", () => ({ WhatsAppApiService: class {} }));
jest.mock("./session.store", () => ({ SessionStore: class {} }));

import { FEED_IDLE_MS, FEED_SENDING_MS, feedDelay } from "./notifications-feed.service";

describe("notifications feed pace", () => {
  const job = (status: string, sending = 0) => ({ id: "b", status, sending }) as any;

  it("asks once a minute when nothing is being sent", () => {
    expect(feedDelay([], [])).toBe(FEED_IDLE_MS);
    expect(feedDelay([job("paused")], [])).toBe(FEED_IDLE_MS);
  });

  it("follows a «Messaggio a tutti» every few seconds while it sends", () => {
    expect(feedDelay([job("running")], [])).toBe(FEED_SENDING_MS);
    expect(feedDelay([job("paused", 2)], [])).toBe(FEED_SENDING_MS);
  });
});

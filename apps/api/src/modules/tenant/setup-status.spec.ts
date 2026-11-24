import { setupSteps } from "./setup-status";

const none = { locations: 0, services: 0, collaborators: 0, scheduledCollaborators: 0, customers: 0, whatsapp: false, remindersActive: false, online: false };

describe("setup steps", () => {
  it("blocks every step on the first missing prerequisite of its chain", () => {
    const view = setupSteps(none);
    const by = Object.fromEntries(view.steps.map((s) => [s.key, s.blockedBy]));
    expect(by).toMatchObject({ location: null, services: "location", team: "location", reminders: "location", online: "location", whatsapp: null });
  });
  it("unlocks reminders only with team and WhatsApp", () => {
    const base = { ...none, locations: 1, services: 3, collaborators: 2, scheduledCollaborators: 2 };
    expect(setupSteps(base).steps.find((s) => s.key === "reminders")!.blockedBy).toBe("whatsapp");
    expect(setupSteps({ ...base, whatsapp: true }).steps.find((s) => s.key === "reminders")!.blockedBy).toBeNull();
  });
  it("needs working hours for the team step", () => {
    const view = setupSteps({ ...none, locations: 1, services: 1, collaborators: 2, scheduledCollaborators: 0 });
    expect(view.steps.find((s) => s.key === "team")!.done).toBe(false);
  });
});

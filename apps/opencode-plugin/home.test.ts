import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  publishPlanToHome,
  resetHomeHelperStateForTest,
  setHomeHelperDepsForTest,
  waitForPublishedPlanDecision,
} from "./home";

const startHomeServerMock = mock(async (_options: unknown) => ({
  port: 19430,
  url: "http://localhost:19430",
  stop: () => {},
}));

const createDashboardSessionMock = mock((_input: unknown) => ({
  id: "session-123",
}));

const waitForDashboardSessionDecisionMock = mock(async (_sessionId: string) => ({
  approved: true,
  agentSwitch: "build",
}));

const openBrowserMock = mock(async (_url: string, _options?: unknown) => true);
const registerSessionMock = mock((_session: unknown) => {});
const fetchImplMock = mock(async () => {
  throw new Error("home server not running");
}) as typeof fetch;

afterEach(() => {
  startHomeServerMock.mockClear();
  createDashboardSessionMock.mockClear();
  waitForDashboardSessionDecisionMock.mockClear();
  openBrowserMock.mockClear();
  registerSessionMock.mockClear();
  fetchImplMock.mockClear();
  resetHomeHelperStateForTest();
});

describe("opencode home helper", () => {
  test("publishes a plan session into the home dashboard and opens the session url", async () => {
    setHomeHelperDepsForTest({
      startHomeServer: startHomeServerMock,
      createDashboardSession: createDashboardSessionMock,
      waitForDashboardSessionDecision: waitForDashboardSessionDecisionMock,
      openBrowser: openBrowserMock,
      getHomePort: () => 19430,
      isRemoteSession: () => false,
      registerSession: registerSessionMock,
      fetchImpl: fetchImplMock,
    });

    const published = await publishPlanToHome({
      plan: "# Plan\n\nShip it",
      directory: "/tmp/my-repo",
      origin: "opencode",
      htmlContent: "<html></html>",
    });

    expect(startHomeServerMock).toHaveBeenCalledTimes(1);
    expect(registerSessionMock).toHaveBeenCalledTimes(1);
    expect(createDashboardSessionMock).toHaveBeenCalledWith({
      plan: "# Plan\n\nShip it",
      project: "my-repo",
      origin: "opencode",
      permissionMode: undefined,
    });
    expect(openBrowserMock).toHaveBeenCalledWith(
      "http://localhost:19430/?session=session-123",
      { isRemote: false },
    );
    expect(published).toEqual({
      sessionId: "session-123",
      url: "http://localhost:19430/?session=session-123",
    });
  });

  test("forwards decision waiting to the shared dashboard store", async () => {
    setHomeHelperDepsForTest({
      waitForDashboardSessionDecision: waitForDashboardSessionDecisionMock,
    });

    await expect(waitForPublishedPlanDecision("session-abc")).resolves.toEqual({
      approved: true,
      agentSwitch: "build",
    });
    expect(waitForDashboardSessionDecisionMock).toHaveBeenCalledWith("session-abc");
  });
});

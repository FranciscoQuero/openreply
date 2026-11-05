import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockPrisma, mockSyncCampaignLinks } = vi.hoisted(() => {
  const mockPrisma = {
    automation: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
    instagramAccount: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { mockPrisma, mockSyncCampaignLinks: vi.fn() };
});

vi.mock("@/lib/db/client", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/auth", () => ({
  getCurrentWorkspaceId: vi.fn(),
}));

vi.mock("@/lib/workspace-access", () => ({
  canManageWorkspace: () => true,
  getCurrentWorkspaceContext: vi.fn(async () => ({
    workspaceId: "workspace_123",
    role: "OWNER",
  })),
}));

vi.mock("@/lib/campaigns/links", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/campaigns/links")>()),
  syncCampaignLinks: mockSyncCampaignLinks,
}));

import { PATCH, POST } from "../app/api/automations/route";

function request(method: "POST" | "PATCH", body: unknown) {
  const url =
    method === "PATCH"
      ? "https://example.com/api/automations?id=automation_123"
      : "https://example.com/api/automations";
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const baseCreate = {
  name: "Spring code",
  postId: "media_101",
  keywords: ["AI PLATFORM"],
};

const storedDmCampaign = {
  id: "automation_123",
  workspaceId: "workspace_123",
  instagramAccountId: "account_1",
  dmEnabled: true,
  dmMessage: "Here is the link: {link}",
  dmTriggerEnabled: true,
  openingDmEnabled: true,
  openingDmMessage: "Hi!",
  openingDmButtonLabel: "Send it",
  requireFollow: true,
  followUpEnabled: true,
  publicReplyEnabled: false,
  publicReplyMessage: null,
  publicReplyMessages: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.workspace.findUnique.mockResolvedValue({ id: "workspace_123" });
  mockPrisma.instagramAccount.findFirst.mockResolvedValue({ id: "account_1" });
  mockPrisma.automation.create.mockImplementation(async ({ data }) => ({
    id: "automation_new",
    ...data,
  }));
  mockPrisma.automation.findFirst.mockResolvedValue(storedDmCampaign);
  mockPrisma.automation.update.mockImplementation(async ({ data }) => ({
    id: "automation_123",
    ...data,
  }));
  mockPrisma.$transaction.mockImplementation(async (fn) => fn(mockPrisma));
});

describe("POST /api/automations — public-reply-only", () => {
  it("creates a campaign with no DM when it has a public reply", async () => {
    const response = await POST(
      request("POST", {
        ...baseCreate,
        dmEnabled: false,
        // DM-only steps sent by a stale client are switched off.
        dmTriggerEnabled: true,
        openingDmEnabled: true,
        openingDmMessage: "Hi!",
        openingDmButtonLabel: "Send it",
        requireFollow: true,
        followUpEnabled: true,
        followUpMessage: "Thanks",
        publicReplyEnabled: true,
        publicReplyMessages: ["Your code is SPRING10", "Code: SPRING10 🎉"],
      })
    );

    expect(response.status).toBe(201);
    expect(mockPrisma.automation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dmEnabled: false,
          dmMessage: "",
          dmTriggerEnabled: false,
          openingDmEnabled: false,
          requireFollow: false,
          followUpEnabled: false,
          publicReplyEnabled: true,
          publicReplyMessages: ["Your code is SPRING10", "Code: SPRING10 🎉"],
        }),
      })
    );
  });

  it("rejects a campaign with no DM and no public reply", async () => {
    const response = await POST(
      request("POST", { ...baseCreate, dmEnabled: false, publicReplyEnabled: false })
    );

    expect(response.status).toBe(400);
    expect(mockPrisma.automation.create).not.toHaveBeenCalled();
  });

  it("rejects a campaign with no DM whose public replies are all blank", async () => {
    const response = await POST(
      request("POST", {
        ...baseCreate,
        dmEnabled: false,
        publicReplyEnabled: true,
        publicReplyMessages: ["   "],
      })
    );

    expect(response.status).toBe(400);
  });

  it("still requires the DM message for a regular campaign", async () => {
    const response = await POST(request("POST", { ...baseCreate }));

    expect(response.status).toBe(400);
    expect(mockPrisma.automation.create).not.toHaveBeenCalled();
  });

  it("keeps regular campaigns as they were", async () => {
    const response = await POST(
      request("POST", { ...baseCreate, dmMessage: "Here you go: {link}" })
    );

    expect(response.status).toBe(201);
    expect(mockPrisma.automation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dmEnabled: true,
          dmMessage: "Here you go: {link}",
        }),
      })
    );
  });
});

describe("PATCH /api/automations — public-reply-only", () => {
  it("turning the DM off clears every DM-only step", async () => {
    const response = await PATCH(
      request("PATCH", {
        dmEnabled: false,
        publicReplyEnabled: true,
        publicReplyMessages: ["Your code is SPRING10"],
      })
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.automation.update).toHaveBeenCalledWith({
      where: { id: "automation_123" },
      data: expect.objectContaining({
        dmEnabled: false,
        dmMessage: "",
        dmTriggerEnabled: false,
        openingDmEnabled: false,
        openingDmMessage: null,
        requireFollow: false,
        followUpEnabled: false,
        publicReplyMessages: ["Your code is SPRING10"],
      }),
    });
  });

  it("refuses to turn the DM off without a public reply", async () => {
    const response = await PATCH(request("PATCH", { dmEnabled: false }));

    expect(response.status).toBe(400);
    expect(mockPrisma.automation.update).not.toHaveBeenCalled();
  });

  it("refuses to remove the last public reply of a campaign without a DM", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue({
      ...storedDmCampaign,
      dmEnabled: false,
      dmMessage: "",
      publicReplyEnabled: true,
      publicReplyMessages: ["Your code is SPRING10"],
    });

    const response = await PATCH(request("PATCH", { publicReplyEnabled: false }));

    expect(response.status).toBe(400);
  });

  it("keeps DM-only steps off on a campaign stored without a DM", async () => {
    mockPrisma.automation.findFirst.mockResolvedValue({
      ...storedDmCampaign,
      dmEnabled: false,
      dmMessage: "",
      publicReplyEnabled: true,
      publicReplyMessages: ["Your code is SPRING10"],
    });

    const response = await PATCH(
      request("PATCH", { openingDmEnabled: true, followUpEnabled: true })
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.automation.update).toHaveBeenCalledWith({
      where: { id: "automation_123" },
      data: expect.objectContaining({
        openingDmEnabled: false,
        followUpEnabled: false,
      }),
    });
  });

  it("refuses to empty the DM message of a regular campaign", async () => {
    const response = await PATCH(request("PATCH", { dmMessage: "  " }));

    expect(response.status).toBe(400);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getUserInfo,
  getUserMedia,
  isFacebookLoginToken,
  makeFacebookLoginToken,
  rawToken,
  sendCommentReply,
} from "../lib/meta/client";
import {
  getFacebookAuthorizationUrl,
  getGrantedInstagramIds,
} from "../lib/meta/facebook-login";

const fetchMock = vi.fn();

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("INSTAGRAM_APP_ID", "app_1");
  vi.stubEnv("FACEBOOK_APP_SECRET", "secret_1");
  vi.stubEnv("META_GRAPH_API_VERSION", "v25.0");
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const stored = makeFacebookLoginToken("1784100", "EAAtoken");

describe("Facebook Login tokens", () => {
  it("round-trips the Instagram account and the raw token", () => {
    expect(isFacebookLoginToken(stored)).toBe(true);
    expect(rawToken(stored)).toBe("EAAtoken");
    expect(isFacebookLoginToken("IGAAtoken")).toBe(false);
    expect(rawToken("IGAAtoken")).toBe("IGAAtoken");
  });

  it("reads the Instagram account node on graph.facebook.com instead of me", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "1784100", username: "4docent.es" })
    );

    const user = await getUserInfo(stored);

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe(
      "https://graph.facebook.com/v25.0/1784100"
    );
    expect(url.searchParams.get("fields")).not.toContain("user_id");
    expect(url.searchParams.get("access_token")).toBe("EAAtoken");
    expect(user.user_id).toBe("1784100");
  });

  it("lists the account's media", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));

    await getUserMedia(stored, 5);

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/v25.0/1784100/media");
  });

  it("replies to a comment with the bare token", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "reply_1" }));

    await sendCommentReply(stored, "comment_1", "Your code: SPRING10");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v25.0/comment_1/replies");
    expect(init.headers.Authorization).toBe("Bearer EAAtoken");
  });

  it("keeps Instagram Login tokens on graph.instagram.com", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "1", user_id: "2", username: "x" }));

    await getUserInfo("IGAAtoken");

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://graph.instagram.com/v25.0/me");
  });
});

describe("Facebook Login flow", () => {
  it("asks for the Instagram scopes, or for a configuration when one is set", () => {
    const withScopes = new URL(getFacebookAuthorizationUrl("https://x/cb", "s"));
    expect(withScopes.hostname).toBe("www.facebook.com");
    expect(withScopes.searchParams.get("client_id")).toBe("app_1");
    expect(withScopes.searchParams.get("scope")).toContain("instagram_manage_comments");

    vi.stubEnv("FACEBOOK_LOGIN_CONFIG_ID", "cfg_1");
    const withConfig = new URL(getFacebookAuthorizationUrl("https://x/cb", "s"));
    expect(withConfig.searchParams.get("config_id")).toBe("cfg_1");
    expect(withConfig.searchParams.get("scope")).toBeNull();
  });

  it("finds the Instagram accounts granted to the token", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: {
          granular_scopes: [
            { scope: "business_management", target_ids: ["biz_1"] },
            { scope: "instagram_basic", target_ids: ["1784100"] },
          ],
        },
      })
    );

    await expect(getGrantedInstagramIds("EAAtoken")).resolves.toEqual(["1784100"]);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get("access_token")).toBe("app_1|secret_1");
  });
});

import { getMetaGraphApiVersion, requireEnv } from "@/lib/env";

/**
 * Facebook Login for Instagram accounts.
 *
 * Since 2026 the Meta console no longer offers "Instagram API with Instagram
 * Login" to new apps, only Facebook Login (for Business). Its tokens are
 * Facebook user tokens for graph.facebook.com, and the Instagram accounts they
 * reach are listed in the token's granular scopes. While the app is in
 * development mode, anyone with a role on it (admin, developer, tester) can
 * connect without App Review.
 *
 * Enable it with META_LOGIN_MODE=facebook. FACEBOOK_LOGIN_CONFIG_ID is
 * optional: set it to use a Facebook Login for Business configuration
 * (it must issue a *user* access token, not a system-user one) instead of the
 * scopes below.
 */

const FACEBOOK_SCOPES = [
  "instagram_basic",
  "instagram_manage_comments",
  "instagram_manage_insights",
  "instagram_manage_messages",
  "business_management",
];

export function isFacebookLoginMode(): boolean {
  return process.env.META_LOGIN_MODE === "facebook";
}

function appId(): string {
  return process.env.FACEBOOK_APP_ID || requireEnv("INSTAGRAM_APP_ID");
}

function appSecret(): string {
  return process.env.FACEBOOK_APP_SECRET || requireEnv("INSTAGRAM_APP_SECRET");
}

function graph(path: string): URL {
  return new URL(
    `https://graph.facebook.com/${getMetaGraphApiVersion()}/${path}`
  );
}

async function getJson<T>(url: URL): Promise<T> {
  const response = await fetch(url.toString());
  const data = await response.json();
  if (!response.ok || data?.error) {
    // The query string carries secrets, so only the path goes in the message.
    throw new Error(
      `${data?.error?.message ?? "Facebook Login request failed"} (${url.pathname})`
    );
  }
  return data as T;
}

export function getFacebookAuthorizationUrl(
  redirectUri: string,
  state: string
): string {
  const params = new URLSearchParams({
    client_id: appId(),
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });
  const configId = process.env.FACEBOOK_LOGIN_CONFIG_ID;
  if (configId) {
    params.set("config_id", configId);
    params.set("override_default_response_type", "true");
  } else {
    params.set("scope", FACEBOOK_SCOPES.join(","));
  }
  return `https://www.facebook.com/${getMetaGraphApiVersion()}/dialog/oauth?${params}`;
}

/**
 * Code → long-lived Facebook user token (about 60 days). `expiresAt` is null
 * when Meta reports a token that does not expire.
 */
export async function exchangeFacebookCode(
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; expiresAt: Date | null }> {
  const exchange = graph("oauth/access_token");
  exchange.searchParams.set("client_id", appId());
  exchange.searchParams.set("client_secret", appSecret());
  exchange.searchParams.set("redirect_uri", redirectUri);
  exchange.searchParams.set("code", code);
  const short = await getJson<{ access_token: string }>(exchange);

  const extend = graph("oauth/access_token");
  extend.searchParams.set("grant_type", "fb_exchange_token");
  extend.searchParams.set("client_id", appId());
  extend.searchParams.set("client_secret", appSecret());
  extend.searchParams.set("fb_exchange_token", short.access_token);
  const long = await getJson<{ access_token: string }>(extend);

  const info = await debugFacebookToken(long.access_token);
  return {
    accessToken: long.access_token,
    expiresAt: info.expires_at ? new Date(info.expires_at * 1000) : null,
  };
}

interface DebugTokenData {
  expires_at?: number;
  granular_scopes?: { scope: string; target_ids?: string[] }[];
}

async function debugFacebookToken(token: string): Promise<DebugTokenData> {
  const url = graph("debug_token");
  url.searchParams.set("input_token", token);
  url.searchParams.set("access_token", `${appId()}|${appSecret()}`);
  const { data } = await getJson<{ data: DebugTokenData }>(url);
  return data;
}

/** The Instagram professional accounts the person granted to this token. */
export async function getGrantedInstagramIds(token: string): Promise<string[]> {
  const info = await debugFacebookToken(token);
  const basic = info.granular_scopes?.find(
    (s) => s.scope === "instagram_basic"
  );
  return basic?.target_ids ?? [];
}

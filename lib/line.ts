import { createHmac, timingSafeEqual } from "node:crypto";

export type LineTextMessageEvent = {
  type: "message";
  webhookEventId?: string;
  replyToken: string;
  source: {
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
  message: {
    type: "text";
    text: string;
  };
};

export type LineWebhookEvent =
  | LineTextMessageEvent
  | {
      type: string;
      webhookEventId?: string;
      replyToken?: string;
      source?: {
        userId?: string;
        groupId?: string;
        roomId?: string;
      };
      message?: {
        type?: string;
        text?: string;
      };
    };

export type LineWebhookPayload = {
  events?: LineWebhookEvent[];
};

type LineReplyMessage = {
  type: "text";
  text: string;
};

export function verifyLineSignature(
  body: string,
  signature: string,
  channelSecret: string,
) {
  const expectedSignature = createHmac("sha256", channelSecret)
    .update(body)
    .digest("base64");
  const expected = Buffer.from(expectedSignature);
  const received = Buffer.from(signature);

  if (expected.length !== received.length) return false;

  return timingSafeEqual(expected, received);
}

export async function replyLineMessage(
  replyToken: string,
  messages: LineReplyMessage[],
) {
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!channelAccessToken) {
    throw new Error("LINE channel access token is not configured");
  }

  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${channelAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      replyToken,
      messages,
    }),
  });

  if (!response.ok) {
    throw new Error(`LINE reply failed with status ${response.status}`);
  }
}

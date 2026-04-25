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

export type LineImageMessageEvent = {
  type: "message";
  webhookEventId?: string;
  replyToken: string;
  source: {
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
  message: {
    id: string;
    type: "image";
    contentProvider?: {
      type?: "line" | "external";
      originalContentUrl?: string;
      previewImageUrl?: string;
    };
  };
};

export type LineWebhookEvent =
  | LineTextMessageEvent
  | LineImageMessageEvent
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
        id?: string;
        type?: string;
        text?: string;
        contentProvider?: {
          type?: string;
          originalContentUrl?: string;
          previewImageUrl?: string;
        };
      };
    };

export type LineWebhookPayload = {
  events?: LineWebhookEvent[];
};

type LineReplyMessage = {
  type: "text";
  text: string;
};

const MAX_LINE_IMAGE_CONTENT_BYTES = 5 * 1024 * 1024;
const LINE_CONTENT_FETCH_TIMEOUT_MS = 10_000;
const allowedLineImageMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export class LineContentTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`LINE content must be ${maxBytes} bytes or smaller`);
  }
}

export class UnsupportedLineImageError extends Error {
  constructor(mimeType: string) {
    super(`Unsupported LINE image content type: ${mimeType}`);
  }
}

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

function normalizeContentType(value: string | null) {
  return value?.split(";")[0]?.trim().toLowerCase() ?? "";
}

async function readResponseBufferWithLimit(
  response: Response,
  maxBytes: number,
) {
  const contentLength = Number(response.headers.get("content-length"));

  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new LineContentTooLargeError(maxBytes);
  }

  if (!response.body) {
    const arrayBuffer = await response.arrayBuffer();

    if (arrayBuffer.byteLength > maxBytes) {
      throw new LineContentTooLargeError(maxBytes);
    }

    return Buffer.from(arrayBuffer);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytesRead = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;

    bytesRead += value.byteLength;

    if (bytesRead > maxBytes) {
      await reader.cancel();
      throw new LineContentTooLargeError(maxBytes);
    }

    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks);
}

export async function getLineImageContent(messageId: string) {
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!channelAccessToken) {
    throw new Error("LINE channel access token is not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    LINE_CONTENT_FETCH_TIMEOUT_MS,
  );

  try {
    const response = await fetch(
      `https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`,
      {
        headers: {
          Authorization: `Bearer ${channelAccessToken}`,
        },
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error(`LINE content fetch failed with status ${response.status}`);
    }

    const mimeType = normalizeContentType(response.headers.get("content-type"));

    if (!allowedLineImageMimeTypes.has(mimeType)) {
      throw new UnsupportedLineImageError(mimeType || "unknown");
    }

    return {
      data: await readResponseBufferWithLimit(
        response,
        MAX_LINE_IMAGE_CONTENT_BYTES,
      ),
      maxBytes: MAX_LINE_IMAGE_CONTENT_BYTES,
      mimeType,
    };
  } finally {
    clearTimeout(timeout);
  }
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

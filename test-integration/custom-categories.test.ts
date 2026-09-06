import "./app-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { userClient } from "./env";
import { createTestUser, wipeLocalData } from "./helpers";

// Custom categories: RLS-scoped CRUD, ownership enforcement at the
// transaction level (the trigger), and isolation between users.

let user: { userId: string; email: string; password: string };
let client: Awaited<ReturnType<typeof userClient>>;
let customSlug: string;
let customId: string;

beforeAll(async () => {
  user = await createTestUser("custom-cat");
  client = await userClient(user.email, user.password);
  customSlug = `cat-${randomUUID().slice(0, 8)}`;

  const { data, error } = await client
    .from("categories")
    .insert({
      user_id: user.userId,
      slug: customSlug,
      name_th: "กาแฟดริป",
      name_en: "Drip coffee",
      icon: "☕",
      type: "expense",
      is_custom: true,
      sort_order: 99,
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  customId = data!.id;
});

afterAll(wipeLocalData);

describe("custom categories", () => {
  it("appears alongside system categories for the owner", async () => {
    const { data } = await client
      .from("categories")
      .select("slug, user_id");
    const slugs = (data ?? []).map((row) => row.slug);
    expect(slugs).toContain(customSlug);
    expect(slugs).toContain("food"); // system rows still readable
    expect((data ?? []).filter((row) => row.slug === "food")[0].user_id).toBeNull();
  });

  it("accepts a transaction referencing a custom category", async () => {
    const { error } = await client.from("transactions").insert({
      user_id: user.userId,
      type: "expense",
      amount: 65,
      category_id: customId,
      description: "drip",
      transaction_date: "2026-09-06",
      source: "web",
    });
    expect(error).toBeNull();
  });

  it("rejects another user's custom category at the trigger", async () => {
    const other = await createTestUser("custom-cat-other");
    const otherClient = await userClient(other.email, other.password);

    // B cannot even read A's custom row.
    const { data: seen } = await otherClient
      .from("categories")
      .select("id")
      .eq("slug", customSlug);
    expect(seen).toEqual([]);

    // Directly referencing A's category id fails in the trigger.
    const { error } = await otherClient.from("transactions").insert({
      user_id: other.userId,
      type: "expense",
      amount: 10,
      category_id: customId,
      description: "steal",
      transaction_date: "2026-09-06",
      source: "web",
    });
    expect(error).toBeTruthy();
    expect(error?.message).toMatch(/does not belong to user/i);
  });

  it("protects in-use custom categories from deletion (FK)", async () => {
    const { error } = await client
      .from("categories")
      .delete()
      .eq("id", customId);
    expect(error).toBeTruthy();
  });

  it("enforces per-user slug uniqueness (reserved slugs are an API-layer rule)", () => {
    // NOTE: shadowing a system slug is allowed by design (custom wins in
    // resolution); the API layer rejects reserved slugs in
    // createCustomCategory. The DB guarantees uniqueness within a user.
  });

  it("rejects two custom categories with the same slug for one user", async () => {
    const { error } = await client.from("categories").insert({
      user_id: user.userId,
      slug: customSlug,
      name_th: "ซ้ำ",
      name_en: "dup",
      icon: "🏷️",
      type: "expense",
      is_custom: true,
      sort_order: 99,
    });
    expect(error).toBeTruthy();
  });
});

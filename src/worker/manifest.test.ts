import { describe, expect, it } from "vitest";
import { manifest } from "./manifest";

const group = { slug: "smith", receiverName: "Grandma" };

describe("manifest", () => {
  it("installs the receiver's tablet full screen", () => {
    expect(manifest(group, "receiver")).toMatchObject({
      name: "easyCall",
      display: "fullscreen",
      start_url: "/smith/",
      scope: "/smith/",
      id: "/smith/",
    });
  });

  it.each(["caller", "admin"] as const)(
    "gives a %s a normal app named after the receiver",
    (role) => {
      expect(manifest(group, role)).toMatchObject({
        name: "Call Grandma",
        short_name: "Call Grandma",
        display: "standalone",
        start_url: "/smith/",
      });
    },
  );

  it("has the icons install needs, including a maskable one", () => {
    expect(manifest(group, "caller")).toMatchObject({
      icons: expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192", type: "image/png" }),
        expect.objectContaining({ sizes: "512x512", type: "image/png" }),
        expect.objectContaining({ purpose: "maskable" }),
      ]) as unknown,
    });
  });
});

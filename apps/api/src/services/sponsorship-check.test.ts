import { describe, it, expect } from "vitest";
import { detectSponsorshipBlock } from "./sponsorship-check.js";

describe("detectSponsorshipBlock", () => {
  it("flags explicit no-sponsorship language", () => {
    expect(detectSponsorshipBlock("We do not offer visa sponsorship for this role.")).not.toBeNull();
  });

  it("flags 'will not sponsor'", () => {
    expect(detectSponsorshipBlock("We will not sponsor employment visas.")).not.toBeNull();
  });

  it("flags 'unable to sponsor'", () => {
    expect(detectSponsorshipBlock("Unfortunately we are unable to sponsor candidates.")).not.toBeNull();
  });

  it("flags 'without sponsorship' requirement", () => {
    expect(
      detectSponsorshipBlock("Must be authorized to work in the US without sponsorship."),
    ).not.toBeNull();
  });

  it("passes when sponsorship is available", () => {
    expect(detectSponsorshipBlock("We offer visa sponsorship for this role.")).toBeNull();
  });

  it("passes when sponsorship is not mentioned at all", () => {
    expect(detectSponsorshipBlock("We are looking for a backend engineer with Java experience.")).toBeNull();
  });
});

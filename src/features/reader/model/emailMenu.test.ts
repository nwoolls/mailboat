import { describe, expect, it } from "vitest";
import { emailMenuItems, emailMenuTarget } from "./emailMenu";

function el(html: string, selector: string): Element {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.querySelector(selector)!;
}

const LINK = "email-link://localhost/open?u=https%3A%2F%2Fx.com";

describe("emailMenuTarget", () => {
  it("finds an image, and the link around it", () => {
    const img = el(`<a href="${LINK}"><img src="https://x.example/a.png"></a>`, "img");
    expect(emailMenuTarget(img)).toEqual({ image: "https://x.example/a.png", link: LINK });
  });
  it("finds a link from text inside it", () => {
    expect(emailMenuTarget(el(`<a href="${LINK}"><b>Pay</b></a>`, "b"))).toEqual({
      image: null,
      link: LINK,
    });
  });
  it("takes inline images but not blocked ones or odd links", () => {
    const inline = el(`<img src="data:image/png;base64,AAAA">`, "img");
    expect(emailMenuTarget(inline).image).toBe("data:image/png;base64,AAAA");
    expect(emailMenuTarget(el(`<img alt="blocked">`, "img")).image).toBeNull();
    expect(emailMenuTarget(el(`<a href="#top">x</a>`, "a")).link).toBeNull();
    expect(emailMenuTarget(null)).toEqual({ image: null, link: null });
  });
  it("accepts Windows' link address too", () => {
    const href = "http://email-link.localhost/open?u=x";
    expect(emailMenuTarget(el(`<a href="${href}">x</a>`, "a")).link).toBe(href);
  });
});

describe("emailMenuItems", () => {
  it("lists image items before link items", () => {
    expect(emailMenuItems({ image: "a", link: "b" })).toEqual([
      "saveImage",
      "copyImage",
      "openLink",
      "copyLink",
    ]);
    expect(emailMenuItems({ image: null, link: "b" })).toEqual(["openLink", "copyLink"]);
  });
});

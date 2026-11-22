// The website's only script. Five small jobs, all optional: the page reads
// fine without it (site.css only hides [data-reveal] when scripting runs).
//
// 1. Fade sections in as they scroll into view.
// 2. Mark the page as scrolled, so the floating header lifts a little.
// 3. Open a screenshot in a zoomed view (a native <dialog>) when clicked.
// 4. Measure where the hero screenshot finishes settling flat.
// 5. Play a card's clip while it's on screen, with a button to pause it (its
//    still shows otherwise).

const reveal = document.querySelectorAll("[data-reveal]");

if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      }
    },
    { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
  );
  for (const el of reveal) io.observe(el);
} else {
  for (const el of reveal) el.classList.add("is-visible");
}

const root = document.documentElement;
const onScroll = () => root.classList.toggle("is-scrolled", window.scrollY > 8);
onScroll();
window.addEventListener("scroll", onScroll, { passive: true });

// The hero screenshot settles flat as the page scrolls (site.css). It should
// be flat by the time it reaches the middle of the window, however tall the
// window is, so the scroll distance that takes is measured here and updated
// when the layout changes. The screenshot's box, not its picture, is
// measured: the picture is the part that tilts and shrinks.
const heroShot = document.querySelector(".hero-shot");
if (heroShot) {
  const measure = () => {
    const box = heroShot.getBoundingClientRect();
    const top = box.top + window.scrollY;
    const centered = top + box.height / 2 - window.innerHeight / 2;
    // In a window so tall that it starts out nearly centered, still leave a
    // short scroll to settle over.
    const end = Math.max(centered, 200);
    heroShot.style.setProperty("--settle-end", `${Math.round(end)}px`);
  };
  measure();
  window.addEventListener("resize", measure, { passive: true });
  if ("ResizeObserver" in window) new ResizeObserver(measure).observe(document.body);
}

// Close the small-screen menu after a link in it is chosen.
for (const menu of document.querySelectorAll("details.menu")) {
  menu.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a")) menu.open = false;
  });
}

// ----- Zoomed screenshots. Every <img data-zoom="images/…"> becomes a button;
// its data-zoom is the path of the full-size picture, without the "-dark.webp"
// or "-light.webp". The view grows out of the clicked picture and shrinks
// back into it (unless reduced motion is asked for).

const zoomables = [...document.querySelectorAll("img[data-zoom]")];

if (zoomables.length && typeof HTMLDialogElement === "function") {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const EASE = "cubic-bezier(0.2, 0.7, 0.2, 1)";

  const dialog = document.createElement("dialog");
  dialog.className = "lightbox";
  dialog.setAttribute("aria-label", "Screenshot");

  const close = document.createElement("button");
  close.type = "button";
  close.className = "lightbox-close";
  close.setAttribute("aria-label", "Close");
  close.textContent = "×";

  // A picture with its caption. Stepping crossfades two of them, stacked in
  // the same place (the dialog's one grid cell): the one shown stays as it
  // is while the next one loads out of sight, then one slides out as the
  // other slides in.
  function slot() {
    const figure = document.createElement("figure");
    const picture = document.createElement("picture");
    const darkSource = document.createElement("source");
    darkSource.media = "(prefers-color-scheme: dark)";
    const big = document.createElement("img");
    big.width = 1600;
    big.height = 900;
    picture.append(darkSource, big);
    const caption = document.createElement("figcaption");
    figure.append(picture, caption);
    return { figure, darkSource, big, caption };
  }
  let current = slot();

  const previous = document.createElement("button");
  previous.type = "button";
  previous.className = "lightbox-step lightbox-prev";
  previous.setAttribute("aria-label", "Previous screenshot");
  previous.textContent = "‹";
  const next = document.createElement("button");
  next.type = "button";
  next.className = "lightbox-step lightbox-next";
  next.setAttribute("aria-label", "Next screenshot");
  next.textContent = "›";

  dialog.append(close, previous, current.figure, next);
  document.body.append(dialog);

  let index = 0;
  let closing = false;

  // The screenshot asked for last: ahead of `index` (the one shown) while
  // a step loads, so steps in a row count from where the person is headed.
  let target = 0;

  const buttons = []; // each screenshot's button, in the same order as zoomables
  const thumb = () => zoomables[index];
  const wrap = (i) => (i + zoomables.length) % zoomables.length;

  // Puts screenshot `at` into a slot: its picture, alt text and caption.
  function show(at, into = current) {
    const img = zoomables[at];
    const base = img.dataset.zoom;
    into.darkSource.srcset = `${base}-dark.webp`;
    into.big.src = `${base}-light.webp`;
    into.big.alt = img.alt;
    const card = img.closest(".feature, .row");
    into.caption.textContent = card?.querySelector("h3, h2")?.textContent ?? "";
  }

  // The zoomed picture's box minus the thumbnail's: a transform that makes
  // the large one look like the small one.
  function fromThumb() {
    const a = thumb().getBoundingClientRect();
    const b = current.big.getBoundingClientRect();
    return `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`;
  }

  // Counts opens and steps, so a reveal still waiting on an older one is
  // dropped.
  let showing = 0;

  // Hides the picture and its caption (still laid out, so animations can
  // measure them) until the full-size picture has loaded and decoded, then
  // shows them. Says whether this is still the latest open or step, and
  // the view still open. Shown before, a picture still loading sat on
  // screen at full size (opening) or popped in after its animation
  // (stepping; owner reports, 2026-11-07 and 2026-11-12).
  async function revealWhenReady(into = current) {
    const ticket = ++showing;
    into.figure.style.visibility = "hidden";
    await into.big.decode().catch(() => {});
    if (ticket !== showing || closing) return false;
    into.figure.style.visibility = "";
    return true;
  }

  // The slots besides the one shown: one loading for a step, or one sliding
  // out. Removed when done, or when the view closes.
  const extras = new Set();
  function drop(extra) {
    extras.delete(extra);
    extra.figure.remove();
  }

  async function open(i) {
    index = target = wrap(i);
    show(index);
    closing = false;
    document.documentElement.classList.add("is-zoomed");
    // The dimmed backdrop shows at once; the picture once it can grow.
    const ready = revealWhenReady();
    dialog.showModal();
    if (!(await ready) || reduceMotion.matches) return;
    current.big.animate(
      [
        { transform: fromThumb(), transformOrigin: "0 0" },
        { transform: "none", transformOrigin: "0 0" },
      ],
      {
        duration: 360,
        easing: EASE,
      },
    );
    current.caption.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 360,
      delay: 120,
      easing: EASE,
      fill: "backwards",
    });
  }

  async function dismiss() {
    if (closing) return;
    closing = true;
    const finish = () => {
      dialog.close();
      document.documentElement.classList.remove("is-zoomed");
      // The browser returns focus to the button the view was opened from; after
      // stepping, the one being viewed is where the person is.
      buttons[index].focus({ preventScroll: true });
      // Drop the closing animations' held end state, or the next open starts faded out.
      for (const a of [...dialog.getAnimations(), ...current.big.getAnimations()]) a.cancel();
      for (const extra of extras) drop(extra);
    };
    if (reduceMotion.matches) return finish();
    // Back into the thumbnail, if it is still on screen; otherwise just fade.
    const r = thumb().getBoundingClientRect();
    const onScreen = r.bottom > 0 && r.top < window.innerHeight;
    const go = current.big.animate(
      onScreen
        ? [
            { transform: "none", transformOrigin: "0 0" },
            { transform: fromThumb(), transformOrigin: "0 0" },
          ]
        : [{ opacity: 1 }, { opacity: 0 }],
      { duration: 260, easing: EASE, fill: "forwards" },
    );
    dialog.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 260,
      easing: "ease",
      fill: "forwards",
    });
    await go.finished.catch(() => {});
    finish();
  }

  // The next or previous screenshot: loaded out of sight while the one shown
  // stays, then crossfaded (owner's choice, 2026-11-12). Cutting straight
  // to the dimmed backdrop and fading the next one in from nothing read as
  // a flash, the longer the slower it loaded.
  async function step(by) {
    if (closing) return;
    // A step still loading gives way to this one.
    for (const extra of extras) if (extra.figure.style.visibility === "hidden") drop(extra);
    const incoming = slot();
    extras.add(incoming);
    current.figure.after(incoming.figure);
    // The one shown (`index`) changes only once this one is ready: closing
    // meanwhile goes back into its thumbnail and focuses its button.
    const at = (target = wrap(target + by));
    show(at, incoming);
    if (!(await revealWhenReady(incoming))) {
      if (extras.has(incoming)) drop(incoming);
      return;
    }
    index = at;
    const leaving = current;
    current = incoming;
    extras.delete(incoming);
    extras.add(leaving);
    // Read once, not twice, while the two cross.
    leaving.figure.setAttribute("aria-hidden", "true");
    // Never shown (a step while the view was still opening): nothing to fade.
    if (reduceMotion.matches || leaving.figure.style.visibility === "hidden") {
      return drop(leaving);
    }
    const timing = { duration: 240, easing: EASE };
    incoming.figure.animate(
      [
        { opacity: 0, transform: `translateX(${by * 24}px)` },
        { opacity: 1, transform: "none" },
      ],
      timing,
    );
    // From where it is now: still sliding in from a step a moment ago, it
    // goes on from there rather than snapping back to fully shown.
    const now = getComputedStyle(leaving.figure);
    const from = { opacity: Number(now.opacity), transform: now.transform };
    for (const a of leaving.figure.getAnimations()) a.cancel();
    const out = leaving.figure.animate(
      [from, { opacity: 0, transform: `translateX(${by * -24}px)` }],
      { ...timing, fill: "forwards" },
    );
    await out.finished.catch(() => {});
    if (extras.has(leaving)) drop(leaving);
  }

  // Each screenshot gets wrapped in a real button, so it works from the keyboard.
  zoomables.forEach((img, i) => {
    const pic = img.closest("picture") ?? img;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "zoom";
    button.setAttribute("aria-label", `Enlarge screenshot: ${img.alt}`);
    pic.replaceWith(button);
    button.append(pic);
    buttons[i] = button;
    button.addEventListener("click", () => open(i));
  });

  close.addEventListener("click", dismiss);
  previous.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));
  // A click on the dimmed area (the dialog itself, not what's in it) closes.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dismiss();
  });
  // Esc: close with the same animation instead of the browser's own.
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dismiss();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") step(-1);
    if (event.key === "ArrowRight") step(1);
  });
}

// ----- Clips. A <video data-clip> plays, muted and looping, while it's on
// screen and showing (one per theme; the other is display: none), unless the
// visitor asks for less motion or has paused it. Otherwise its still (the
// poster) shows. Nothing loads until it would play (preload="none").
// A Pause / Play button sits on the card (WCAG 2.2.2: motion that starts by
// itself and lasts over five seconds can be paused). It says what pressing it
// will do now: Pause while the clip plays, Play otherwise (paused by the
// visitor, or a browser that wouldn't start it by itself). A pause is
// remembered on this browser. Reduced motion hides the button and puts the
// still back, even mid-play.
const clips = [...document.querySelectorAll("video[data-clip]")];
if (clips.length > 0 && "IntersectionObserver" in window) {
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  const onScreen = new Set();
  const KEY = "clips-paused";
  let held = false;
  try {
    held = localStorage.getItem(KEY) === "1";
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  const toggles = [];
  const update = () => {
    for (const clip of clips) {
      const play = onScreen.has(clip) && !held && !calm.matches && clip.getClientRects().length > 0;
      if (play && clip.paused) clip.play().catch(() => {});
      else if (!play && !clip.paused) clip.pause();
      // Asked for less motion: back to the still, not a frozen frame.
      if (calm.matches && clip.currentTime > 0) clip.load();
    }
    label();
  };
  const playing = () => clips.some((clip) => !clip.paused);
  const label = () => {
    const on = playing();
    for (const toggle of toggles) {
      toggle.textContent = on ? "Pause" : "Play";
      toggle.setAttribute("aria-label", on ? "Pause the clip" : "Play the clip");
    }
  };
  // One button per card that has clips.
  for (const card of new Set(clips.map((clip) => clip.parentElement))) {
    if (!card) continue;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "clip-toggle";
    toggle.addEventListener("click", () => {
      // Pausing what plays, or playing what doesn't, whatever the reason it
      // wasn't (the click lets a browser that refused to start it, start it).
      held = playing();
      try {
        localStorage.setItem(KEY, held ? "1" : "0");
      } catch {
        // As above.
      }
      update();
    });
    card.classList.add("has-clip");
    card.append(toggle);
    toggles.push(toggle);
  }
  const watch = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) onScreen.add(entry.target);
        else onScreen.delete(entry.target);
      }
      update();
    },
    { threshold: 0.4 },
  );
  for (const clip of clips) {
    watch.observe(clip);
    clip.addEventListener("play", label);
    clip.addEventListener("pause", label);
  }
  calm.addEventListener("change", update);
  dark.addEventListener("change", update);
  update();
}

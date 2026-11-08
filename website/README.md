# Website

The site at getmailboat.app: plain HTML, CSS and JavaScript, with no build
step and no backend. It is meant to be served by Cloudflare as it is (decided
2026-11-06, see the Architecture decisions).

- `index.html`, `privacy.html`, `terms.html`: the pages. The header and
  footer are repeated in each page; change them in all of them.
- `site.css`: the one stylesheet. Colors follow the visitor's system theme.
- `site.js`: fades sections in as they scroll into view, lifts the header
  once the page scrolls, and opens a screenshot in a zoomed view (a native
  `<dialog>`) when it is clicked: any `<img data-zoom="images/…">` is made
  clickable, and `data-zoom` names its full-size pictures. The pages read
  fine without it.
- `.well-known/security.txt`: where to report a security problem (RFC 9116),
  naming `SECURITY.md`. Its `Expires` date must be renewed before it passes,
  at most a year ahead: `bun run check:website` warns in the last 60 days and
  fails once it has passed. `check:website` also requires a "Security" link in
  every page's footer.
- `_headers`: security headers Cloudflare adds to every response. The
  Content Security Policy allows only the site's own files, so no inline
  scripts or `style` attributes.
- `fonts/`: Inter and Geist Mono (Latin), self-hosted so visitors' browsers
  never contact Google. Both are under the SIL Open Font License (the
  `OFL-*.txt` files).
- `images/`: WebP copies of the Demo-mode screenshots in `docs/images` (full size
  for the hero and the two spotlight sections, half size in `cards/` for the
  feature cards, one per section of `docs/FEATURES.md`),
  made by `scripts/build-website-images.sh`. Only Demo mode is ever
  pictured.

## Publishing

A push to `main` that changes this folder, `.github/website/` or the workflow itself runs `.github/workflows/website.yml`,
which checks the site and deploys it to Cloudflare. Pull requests never deploy.
`404.html` is shown, with a real 404 status, for any address that isn't a file.
Its links and files are root-absolute (`/site.css`) because it is served at the
address that was asked for.

The deploy token expires on 2027-11-07. To rotate it, create a new account-owned
token in Cloudflare with only **Workers Scripts: Edit**, replace the
`CLOUDFLARE_API_TOKEN` secret in the repository's `website` environment, then
delete the old token.

To preview, serve the folder and open it in a browser:

```
python3 -m http.server 4321 --directory website
```

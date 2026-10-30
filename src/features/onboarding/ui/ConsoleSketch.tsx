import { APP_NAME } from "../../../shared/lib/brand";
import type { GuideStepId } from "../model/onboarding";

/**
 * Small pictures of Google's pages, drawn as SVG in Google's Material
 * style and set in a browser frame with the page's address, so they read
 * as a screenshot and not as part of the app: our own buttons are the only
 * solid blue in the window. Drawn, not screenshotted, because Google
 * redesigns these pages and a drawing is easy to redraw, and it has no
 * logos. The wording on them is Google's own, as it appears for a project
 * in Testing (checked on Windows, 2026-10-29). Pictures are decorative: the
 * text beside them says what to do.
 */

const FONT = "'Google Sans','Product Sans',Roboto,Arial,sans-serif";
const WIDTH = 440;
const BLUE = "#1a73e8";
const INK = "#202124";
const GREY = "#5f6368";
const LINE = "#dadce0";

/** The browser frame: chrome, address bar and a white page. */
function Page({
  url,
  height,
  children,
}: {
  url: string;
  height: number;
  children: React.ReactNode;
}) {
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${height}`}
      aria-hidden
      className="block w-full"
      fontFamily={FONT}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="1"
        y="1"
        width="438"
        height={height - 2}
        rx="12"
        fill="#fff"
        stroke={LINE}
        strokeWidth="2"
      />
      <path d="M1 13a12 12 0 0 1 12-12h414a12 12 0 0 1 12 12v26H1z" fill="#f1f3f4" />
      {[22, 40, 58].map((cx) => (
        <circle key={cx} cx={cx} cy="20" r="5" fill={LINE} />
      ))}
      <rect x="84" y="9" width="330" height="22" rx="11" fill="#fff" stroke={LINE} />
      <text x="100" y="24.5" fontSize="12" fill={GREY}>
        {url}
      </text>
      {children}
    </svg>
  );
}

/** A Material outlined text field with its label on the border. */
function Field({
  y,
  label,
  value,
  caret = false,
}: {
  y: number;
  label: string;
  value: string;
  caret?: boolean;
}) {
  return (
    <g>
      <rect
        x="24"
        y={y}
        width="392"
        height="46"
        rx="4"
        fill="#fff"
        stroke="#80868b"
        strokeWidth="1.5"
      />
      <rect x="34" y={y - 8} width={label.length * 6.4 + 8} height="16" fill="#fff" />
      <text x="38" y={y + 5} fontSize="11.5" fill={GREY}>
        {label}
      </text>
      <text x="36" y={y + 29} fontSize="15" fill={INK}>
        {value}
      </text>
      {caret && <path d={`M390 ${y + 20}l6 6 6-6`} fill="none" stroke={GREY} strokeWidth="2" />}
    </g>
  );
}

function FilledButton({ x, y, w, label }: { x: number; y: number; w: number; label: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height="36" rx="18" fill={BLUE} />
      <text x={x + w / 2} y={y + 23} fontSize="14" fill="#fff" fontWeight="500" textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

function OutlinedButton({ x, y, w, label }: { x: number; y: number; w: number; label: string }) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height="32"
        rx="16"
        fill="none"
        stroke="#747775"
        strokeWidth="1.5"
      />
      <text
        x={x + w / 2}
        y={y + 21}
        fontSize="14"
        fill="#0b57d0"
        fontWeight="500"
        textAnchor="middle"
      >
        {label}
      </text>
    </g>
  );
}

function TextButton({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <text x={x} y={y} fontSize="14" fill={BLUE} fontWeight="500">
      {label}
    </text>
  );
}

function Heading({ y, size = 24, children }: { y: number; size?: number; children: string }) {
  return (
    <text x="24" y={y} fontSize={size} fill={INK}>
      {children}
    </text>
  );
}

const PROJECT_ID = `${APP_NAME.toLowerCase()}-8f3k2q`;

const PICTURES: Record<GuideStepId, () => React.ReactNode> = {
  project: () => (
    <Page url="console.cloud.google.com/projectcreate" height={340}>
      <text x="24" y="70" fontSize="13" fill={GREY}>
        Google Cloud
      </text>
      <Heading y={108}>New Project</Heading>
      <Field y={130} label="Project name *" value={APP_NAME} />
      <text x="24" y="192" fontSize="11" fill={GREY}>
        {`Project ID: ${PROJECT_ID}. It cannot be changed later.`}
      </text>
      <Field y={206} label="Location *" value="No organisation" />
      <text x="340" y="234" fontSize="12.5" fill={BLUE} fontWeight="500">
        BROWSE
      </text>
      <TextButton x={248} y={294} label="Cancel" />
      <FilledButton x={316} y={272} w={100} label="Create" />
    </Page>
  ),
  apis: () => (
    <Page url="console.cloud.google.com/apis/library" height={340}>
      <Heading y={86} size={22}>
        Enable access to APIs
      </Heading>
      <text x="24" y="112" fontSize="12.5" fill={GREY}>
        {`These APIs will be enabled for project ${APP_NAME}`}
      </text>
      {["Gmail API", "People API", "Google Calendar API"].map((name, i) => (
        <g key={name}>
          <circle cx="40" cy={158 + i * 40} r="11" fill="#e6f4ea" />
          <path d={`M34 ${158 + i * 40}l4 4 8-8`} fill="none" stroke="#188038" strokeWidth="2.2" />
          <text x="62" y={163 + i * 40} fontSize="15" fill={INK}>
            {name}
          </text>
          <line x1="24" y1={178 + i * 40} x2="416" y2={178 + i * 40} stroke={LINE} />
        </g>
      ))}
      <TextButton x={248} y={294} label="Cancel" />
      <FilledButton x={316} y={272} w={100} label="Enable" />
    </Page>
  ),
  branding: () => (
    <Page url="console.cloud.google.com/auth/overview" height={352}>
      <Heading y={82}>Get started</Heading>
      <text x="24" y="112" fontSize="14" fill={GREY}>
        App Information
      </text>
      <Field y={134} label="App name *" value={APP_NAME} />
      <Field y={198} label="User support email *" value="you@gmail.com" caret />
      <text x="24" y="276" fontSize="13" fill={GREY}>
        Audience
      </text>
      <circle cx="34" cy="296" r="7" fill="none" stroke={GREY} strokeWidth="2" />
      <text x="50" y="301" fontSize="14" fill={INK}>
        Internal
      </text>
      <circle cx="170" cy="296" r="7" fill="none" stroke={BLUE} strokeWidth="2" />
      <circle cx="170" cy="296" r="3.5" fill={BLUE} />
      <text x="186" y="301" fontSize="14" fill={INK}>
        External
      </text>
      <FilledButton x={316} y={308} w={100} label="Next" />
    </Page>
  ),
  users: () => (
    <Page url="console.cloud.google.com/auth/audience" height={300}>
      <Heading y={82} size={22}>
        Audience
      </Heading>
      <text x="24" y="116" fontSize="13" fill={GREY}>
        Publishing status
      </text>
      <text x="24" y="140" fontSize="16" fill={INK} fontWeight="500">
        Testing
      </text>
      <line x1="24" y1="162" x2="416" y2="162" stroke={LINE} />
      <text x="24" y="190" fontSize="16" fill={INK}>
        Test users
      </text>
      <OutlinedButton x={24} y={202} w={124} label="+ Add users" />
      <line x1="24" y1="252" x2="416" y2="252" stroke={LINE} />
      <text x="34" y="274" fontSize="14" fill={INK}>
        you@gmail.com
      </text>
      <line x1="24" y1="286" x2="416" y2="286" stroke={LINE} />
    </Page>
  ),
  client: () => (
    <Page url="console.cloud.google.com/auth/clients/create" height={340}>
      <Heading y={84} size={22}>
        Create OAuth client ID
      </Heading>
      <Field y={116} label="Application type *" value="Desktop app" caret />
      <Field y={186} label="Name *" value={APP_NAME} />
      <text x="24" y="250" fontSize="11" fill={GREY}>
        The name is only shown in the Console, not to people signing in.
      </text>
      <TextButton x={248} y={312} label="Cancel" />
      <FilledButton x={316} y={290} w={100} label="Create" />
    </Page>
  ),
};

export function ConsoleSketch({ step }: { step: GuideStepId }) {
  return <>{PICTURES[step]()}</>;
}

/**
 * What Google shows at a first sign-in to a project in Testing, in the
 * order it shows it: the warning (expected: it's the person's own private
 * project) and the permissions, which start with every box empty.
 */
export function SignInSketches() {
  return (
    <div className="grid grid-cols-2 gap-3">
      <figure>
        <Page url="accounts.google.com" height={300}>
          <text x="28" y="92" fontSize="25" fill={INK}>
            Google hasn’t verified
          </text>
          <text x="28" y="122" fontSize="25" fill={INK}>
            this app
          </text>
          <text x="28" y="156" fontSize="13.5" fill="#3c4043">
            You’ve been given access to an app that’s
          </text>
          <text x="28" y="176" fontSize="13.5" fill="#3c4043">
            currently being tested. You should only
          </text>
          <text x="28" y="196" fontSize="13.5" fill="#3c4043">
            continue if you know the developer.
          </text>
          <text x="150" y="262" fontSize="15" fill="#0b57d0" fontWeight="500" textAnchor="middle">
            Continue
          </text>
          <rect x="230" y="240" width="140" height="36" rx="18" fill="#d3e3fd" />
          <text x="300" y="263" fontSize="14.5" fill="#041e49" fontWeight="500" textAnchor="middle">
            Back to safety
          </text>
        </Page>
        <figcaption className="mt-1 text-center text-[10.5px] text-content/55">
          1 · The warning
        </figcaption>
      </figure>
      <figure>
        <Page url="accounts.google.com" height={300}>
          <text x="28" y="76" fontSize="20" fill={INK}>
            {`${APP_NAME} wants access to`}
          </text>
          <text x="28" y="100" fontSize="20" fill={INK}>
            your Google Account
          </text>
          <text x="28" y="136" fontSize="13" fill="#3c4043">
            {`Select what ${APP_NAME} can access`}
          </text>
          {[
            ["Select all", 164],
            ["Contacts and calendars", 206],
            ["Gmail: read, compose, settings", 236],
          ].map(([label, y]) => (
            <g key={label}>
              <rect
                x="28"
                y={Number(y) - 14}
                width="18"
                height="18"
                rx="3"
                fill="#fff"
                stroke={GREY}
                strokeWidth="2"
              />
              <text x="58" y={y} fontSize="14" fill={INK}>
                {label}
              </text>
            </g>
          ))}
          <line x1="28" y1="180" x2="372" y2="180" stroke={LINE} />
          <rect
            x="262"
            y="258"
            width="108"
            height="30"
            rx="15"
            fill="none"
            stroke="#747775"
            strokeWidth="1.5"
          />
          <text x="316" y="278" fontSize="14" fill="#0b57d0" fontWeight="500" textAnchor="middle">
            Continue
          </text>
        </Page>
        <figcaption className="mt-1 text-center text-[10.5px] text-content/55">
          2 · The permissions (they start empty)
        </figcaption>
      </figure>
    </div>
  );
}

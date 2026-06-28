const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "src");
const appPath = path.join(root, "App.jsx");
const source = fs.readFileSync(appPath, "utf8");
const markerNames = [
  ["Dashboard.jsx", "function Dashboard("],
  ["HelpPage.jsx", "function HelpPage("],
  ["AnalyticsPage.jsx", "function AnalyticsPage("],
  ["HistoryPage.jsx", "function HistoryPage("],
  ["MobileNav.jsx", "function MobileNav("],
  ["RegistrationPage.jsx", "const USERNAME_REGEX ="],
  ["export", "export default App;"],
];

const markers = markerNames.map(([file, marker]) => ({
  file,
  marker,
  index: source.indexOf(marker),
}));

for (const item of markers) {
  if (item.index === -1) {
    throw new Error(`Missing marker ${item.marker}`);
  }
}

const viewsDir = path.join(root, "views");
fs.mkdirSync(viewsDir, { recursive: true });

const headers = {
  "Dashboard.jsx": `import { useEffect, useState } from 'react';
import freighterApi from '@stellar/freighter-api';
import { useLatencyTracker } from '../useLatencyTracker';
import LatencyGauge from '../LatencyGauge';
import NetworkBadge from '../NetworkBadge';
import { useDebounce } from '../useDebounce';
import ScrollToTop from '../ScrollToTop';
import LoadingSpinner from '../components/LoadingSpinner';
import MobileNav from './MobileNav';
import {
  API_BASE,
  CONTRACT_ID,
  NAV_STORAGE_KEY,
  TOKEN_ADDRESS,
  TREASURY_ADDRESS,
  formatShortAddress,
  formatUsername,
  loadStellarSdk,
  resolveRecipient,
  useNavState,
  useWalletMenu,
} from './shared';

`,
  "HelpPage.jsx": `import { useState } from 'react';
import ScrollToTop from '../ScrollToTop';
import MobileNav from './MobileNav';
import { NAV_STORAGE_KEY, useNavState } from './shared';

`,
  "AnalyticsPage.jsx": `import { useEffect, useState } from 'react';
import NetworkBadge from '../NetworkBadge';
import LoadingSpinner from '../components/LoadingSpinner';
import ScrollToTop from '../ScrollToTop';
import MobileNav from './MobileNav';
import {
  ANALYTICS_MAX_PAGES,
  ANALYTICS_PAGE_LIMIT,
  ANALYTICS_REFRESH_MS,
  ANALYTICS_WINDOW_MS,
  HORIZON_BASE,
  NAV_STORAGE_KEY,
  formatShortAddress,
  useNavState,
  useWalletMenu,
} from './shared';

`,
  "HistoryPage.jsx": `import { Fragment, useCallback, useEffect, useState } from 'react';
import NetworkBadge from '../NetworkBadge';
import ScrollToTop from '../ScrollToTop';
import MobileNav from './MobileNav';
import { HORIZON_BASE, NAV_STORAGE_KEY, formatShortAddress, useNavState, useWalletMenu } from './shared';

`,
  "MobileNav.jsx": "",
  "RegistrationPage.jsx": `import { useEffect, useState } from 'react';
import freighterApi from '@stellar/freighter-api';
import LoadingSpinner from '../components/LoadingSpinner';
import { API_BASE, normalizeNameTag } from './shared';

`,
};

for (let i = 0; i < markers.length - 1; i += 1) {
  const file = markers[i].file;
  const body = source.slice(markers[i].index, markers[i + 1].index).trimEnd();
  const exportName =
    file === "RegistrationPage.jsx"
      ? "RegistrationPage"
      : file.replace(".jsx", "");
  fs.writeFileSync(
    path.join(viewsDir, file),
    `${headers[file]}${body}\n\nexport default ${exportName};\n`,
  );
}

fs.writeFileSync(
  path.join(viewsDir, "shared.js"),
  `import { useEffect, useRef, useState } from 'react';

export const CONTRACT_ID = 'CDNQ7OMHIFOLZHOKWQLOGDW7CF3DRMKXJC6OULNGNBWF4O4NO2NEIGER';
export const TREASURY_ADDRESS = 'GAAFWEZKDYPXLTQGKQ3F23TXWYQUDAYTDW7P7VUQSVJFW2GWC4Y6LWST';
export const TOKEN_ADDRESS = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
export const API_BASE = 'https://stellar-tags-production.up.railway.app';
export const DEFAULT_FEDERATION_DOMAIN = 'localhost';
export const HORIZON_BASE = 'https://horizon-testnet.stellar.org';
export const ANALYTICS_WINDOW_MS = 60 * 60 * 1000;
export const ANALYTICS_PAGE_LIMIT = 200;
export const ANALYTICS_MAX_PAGES = 5;
export const ANALYTICS_REFRESH_MS = 60 * 1000;
export const NAV_STORAGE_KEY = 'stellar-nav-open';

let stellarSdkPromise;
export const loadStellarSdk = () => {
  if (!stellarSdkPromise) {
    stellarSdkPromise = import('@stellar/stellar-sdk');
  }
  return stellarSdkPromise;
};

export const normalizeNameTag = (value) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  return trimmed.includes('*')
    ? trimmed
    : \`\${trimmed}*\${DEFAULT_FEDERATION_DOMAIN}\`;
};

export const resolveRecipient = async (inputValue) => {
  const trimmed = inputValue.trim();
  if (!trimmed) {
    return { error: 'Please enter a username or wallet address.' };
  }

  const { StrKey } = await loadStellarSdk();
  if (StrKey.isValidEd25519PublicKey(trimmed)) {
    return { address: trimmed };
  }

  const normalizedTag = normalizeNameTag(trimmed);
  return { tag: normalizedTag };
};

export const formatUsername = (value) => {
  if (!value) {
    return '';
  }

  return value.split('*')[0];
};

export const formatShortAddress = (value) => {
  if (!value) {
    return '';
  }

  if (value.length < 10) {
    return value;
  }

  return \`\${value.substring(0, 4)}...\${value.substring(52)}\`;
};

export const useNavState = () => {
  const [isNavOpen, setIsNavOpen] = useState(() => {
    const stored = sessionStorage.getItem(NAV_STORAGE_KEY);
    if (stored === 'true' || stored === 'false') {
      return stored === 'true';
    }

    return window.matchMedia('(min-width: 769px)').matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const syncNav = (event) => {
      if (event.matches) {
        setIsNavOpen(false);
      }
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', syncNav);
      return () => mediaQuery.removeEventListener('change', syncNav);
    }

    mediaQuery.addListener(syncNav);
    return () => mediaQuery.removeListener(syncNav);
  }, []);

  useEffect(() => {
    sessionStorage.setItem(NAV_STORAGE_KEY, String(isNavOpen));
  }, [isNavOpen]);

  return [isNavOpen, setIsNavOpen];
};

export const useWalletMenu = () => {
  const menuRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return { menuRef, isOpen, setIsOpen };
};
`,
);

let app = `${source.slice(0, markers[0].index).trimEnd()}\n\nexport default App;\n`;
const appHeader = `import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import freighterApi from '@stellar/freighter-api';
import LoadingSpinner from './components/LoadingSpinner';
import { HORIZON_BASE } from './views/shared';

const Dashboard = lazy(() => import('./views/Dashboard.jsx'));
const HelpPage = lazy(() => import('./views/HelpPage.jsx'));
const AnalyticsPage = lazy(() => import('./views/AnalyticsPage.jsx'));
const HistoryPage = lazy(() => import('./views/HistoryPage.jsx'));
const RegistrationPage = lazy(() => import('./views/RegistrationPage.jsx'));

function ViewFallback({ label = 'Loading view...' }) {
  return (
    <div className="route-fallback" role="status" aria-live="polite">
      <LoadingSpinner color="text-blue" />
      <span>{label}</span>
    </div>
  );
}

`;

app = app.replace(/^import[\s\S]*?function App\(\) \{/, `${appHeader}function App() {`);

const wrapComponent = (text, name, label) => {
  const matcher = new RegExp(`^\\s*<${name}\\b`, "m");
  const match = matcher.exec(text);
  const start = match?.index ?? -1;
  if (start === -1) {
    throw new Error(`Missing ${name}`);
  }

  const endMatcher = /^\s*\/>/m;
  const endMatch = endMatcher.exec(text.slice(start));
  const end = endMatch ? start + endMatch.index : -1;
  if (end === -1) {
    throw new Error(`Missing end for ${name}`);
  }

  const endLength = endMatch[0].length;
  const component = text.slice(start, end + endLength);
  return `${text.slice(0, start)}        <Suspense fallback={<ViewFallback label="${label}" />}>
${component}
        </Suspense>${text.slice(end + endLength)}`;
};

app = wrapComponent(app, "RegistrationPage", "Loading registration...");
app = wrapComponent(app, "HelpPage", "Loading help center...");
app = wrapComponent(app, "AnalyticsPage", "Loading analytics...");
app = wrapComponent(app, "HistoryPage", "Loading history...");
app = wrapComponent(app, "Dashboard", "Loading dashboard...");
fs.writeFileSync(appPath, app);

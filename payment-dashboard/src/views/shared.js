import { useEffect, useRef, useState } from 'react';

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
    : `${trimmed}*${DEFAULT_FEDERATION_DOMAIN}`;
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

  return `${value.substring(0, 4)}...${value.substring(52)}`;
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

"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { isNetworkKey, NETWORKS, type NetworkDef, type NetworkKey } from "@/lib/networks";

type NetworkContextValue = {
  key: NetworkKey;
  net: NetworkDef;
  setNetwork: (next: NetworkKey) => void;
  isMainnet: boolean;
};

const NetworkContext = createContext<NetworkContextValue | null>(null);

const STORAGE_KEY = "arc-facilitator:network";

/**
 * Site-wide mainnet/testnet selection.
 *
 * Resolution order is `?network=` → localStorage → the configured default. The
 * query parameter wins and is written back on every change, so any page — and
 * any docs link, where the snippets differ per network — is shareable and lands
 * the reader on the same network the author was looking at.
 */
export function NetworkProvider({
  defaultNetwork,
  children,
}: {
  defaultNetwork: NetworkKey;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fromUrl = searchParams.get("network");

  // Server and first client render must agree, so the stored preference is only
  // applied after mount. Without this the markup would mismatch for anyone whose
  // saved network differs from the default.
  const [stored, setStored] = useState<NetworkKey | null>(null);
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isNetworkKey(saved)) setStored(saved);
  }, []);

  const key: NetworkKey = isNetworkKey(fromUrl) ? fromUrl : (stored ?? defaultNetwork);

  const setNetwork = useCallback(
    (next: NetworkKey) => {
      window.localStorage.setItem(STORAGE_KEY, next);
      setStored(next);
      const params = new URLSearchParams(searchParams.toString());
      params.set("network", next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const value = useMemo<NetworkContextValue>(
    () => ({ key, net: NETWORKS[key], setNetwork, isMainnet: key === "mainnet" }),
    [key, setNetwork],
  );

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): NetworkContextValue {
  const value = useContext(NetworkContext);
  if (!value) throw new Error("useNetwork must be used inside <NetworkProvider>");
  return value;
}

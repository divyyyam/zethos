"use client";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, LoaderCircle, ReceiptText, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { zethos } from "../../../lib/engine/sdk";
import { formatNumber, platformConfig, shortAddress } from "../../../lib/platform-config";
import { useWallet } from "../../wallet/wallet-provider";
import { EmptyState, ExternalLink } from "../primitives";

export function RecentSwaps() {
  const { address, isConnected } = useAccount();
  const { openWallet } = useWallet();
  const query = useQuery({
    queryKey: ["engine", "fills", address],
    queryFn: () => {
      if (!address || !zethos) throw new Error("Connect your wallet to read paper fills.");
      return zethos.fills({ taker: address, limit: 20 });
    },
    enabled: Boolean(address && platformConfig.engineUrl),
    retry: false,
  });
  if (!isConnected)
    return (
      <div className="p-card">
        <EmptyState
          icon={<ReceiptText size={21} strokeWidth={1.3} />}
          title="No swaps yet"
          action={
            <button type="button" className="p-text-button" onClick={openWallet}>
              Connect wallet
              <ArrowUpRight size={13} />
            </button>
          }
        >
          Connect a wallet to see your swaps.
        </EmptyState>
      </div>
    );
  if (query.isError)
    return (
      <div className="p-card">
        <EmptyState
          icon={<ReceiptText size={21} />}
          title="Couldn’t load your swaps"
          action={
            <button type="button" className="p-text-button" onClick={() => void query.refetch()}>
              Try again
              <RefreshCw size={12} />
            </button>
          }
        >
          Your funds are unaffected.
        </EmptyState>
      </div>
    );
  if (!query.data?.length)
    return (
      <div className="p-card">
        <EmptyState
          icon={
            query.isFetching ? (
              <LoaderCircle size={21} className="p-spin" />
            ) : (
              <ReceiptText size={21} strokeWidth={1.3} />
            )
          }
          title={query.isFetching ? "Loading swaps" : "No swaps yet"}
        >
          {query.isFetching
            ? "Fetching your swap activity."
            : "Your confirmed paper and on-chain fills will appear here."}
        </EmptyState>
      </div>
    );
  return (
    <div className="p-card p-table-wrap">
      <table className="p-table">
        <thead>
          <tr>
            <th scope="col">Pair</th>
            <th scope="col">Filled</th>
            <th scope="col">Price 5 s later</th>
            <th scope="col">Settlement</th>
          </tr>
        </thead>
        <tbody>
          {query.data.map((fill) => (
            <tr key={fill.id}>
              <td>{fill.pair}</td>
              <td>
                {new Date(fill.ts > 1e12 ? fill.ts : fill.ts * 1000).toLocaleString("en-GB", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </td>
              <td>
                {fill.markouts?.["5"] !== undefined
                  ? `${formatNumber(fill.markouts["5"])} bps · vault view`
                  : "Measuring…"}
              </td>
              <td>
                {fill.paper ? (
                  <Link className="p-text-link" href={`/arena#${fill.id}`}>
                    Paper fill
                  </Link>
                ) : fill.txHash ? (
                  <ExternalLink href={`${platformConfig.explorer}/tx/${fill.txHash}`}>
                    {shortAddress(fill.txHash)}
                  </ExternalLink>
                ) : (
                  "Awaiting settlement"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

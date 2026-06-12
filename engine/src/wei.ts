// Minimal, dependency-free ETH <-> wei helpers using BigInt so policy
// comparisons are exact (no floating point). 1 ETH = 10^18 wei.

const WEI_PER_ETH = 10n ** 18n;

/** Parse a decimal ETH string (e.g. "0.05") into wei as a BigInt. */
export function ethToWei(eth: string): bigint {
  const trimmed = String(eth).trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") {
    throw new Error(`invalid ETH amount: "${eth}"`);
  }
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > 18) {
    throw new Error(`too many decimals in ETH amount: "${eth}"`);
  }
  const fracPadded = frac.padEnd(18, "0");
  return BigInt(whole || "0") * WEI_PER_ETH + BigInt(fracPadded || "0");
}

/** Format wei (BigInt) back into a trimmed decimal ETH string. */
export function weiToEth(wei: bigint): string {
  const neg = wei < 0n;
  const abs = neg ? -wei : wei;
  const whole = abs / WEI_PER_ETH;
  const frac = abs % WEI_PER_ETH;
  let fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "");
  const out = fracStr ? `${whole}.${fracStr}` : `${whole}`;
  return neg ? `-${out}` : out;
}

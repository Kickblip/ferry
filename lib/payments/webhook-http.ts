import dns from "node:dns"
import https from "node:https"
import { BlockList, isIP } from "node:net"

const privateAddresses = new BlockList()
for (const subnet of [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
]) {
  const [address, prefix] = subnet.split("/")
  privateAddresses.addSubnet(address, Number(prefix), "ipv4")
}
for (const subnet of ["2001::/23", "2001:db8::/32", "2002::/16", "3fff::/20"]) {
  const [address, prefix] = subnet.split("/")
  privateAddresses.addSubnet(address, Number(prefix), "ipv6")
}
const globalIPv6 = new BlockList()
globalIPv6.addSubnet("2000::", 3, "ipv6")

function isPublicAddress(address: string) {
  const family = isIP(address)
  if (family === 4) return !privateAddresses.check(address, "ipv4")
  // This also excludes mapped IPv4, link-local, loopback and unique-local IPv6.
  return (
    family === 6 &&
    globalIPv6.check(address, "ipv6") &&
    !privateAddresses.check(address, "ipv6")
  )
}

export function validateWebhookUrl(value: unknown): string {
  const invalid = () =>
    new Error(
      "Enter a public HTTPS callback URL without credentials or a fragment"
    )
  if (typeof value !== "string" || !value.trim() || value.trim().length > 2048)
    throw invalid()
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw invalid()
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "")
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.href.includes("#") ||
    (!hostname.includes(".") && !isIP(hostname)) ||
    /(^|\.)(localhost|local|internal)$/.test(hostname) ||
    (isIP(hostname) && !isPublicAddress(hostname))
  )
    throw invalid()
  return url.toString()
}

export async function postWebhook(
  url: string,
  body: string,
  signature: string
): Promise<number> {
  const target = validateWebhookUrl(url)
  return new Promise((resolve, reject) => {
    const request = https.request(
      target,
      {
        method: "POST",
        agent: false,
        signal: AbortSignal.timeout(5_000),
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "X-Ferry-Signature": signature,
        },
        // Resolve once inside the connection's lookup so a DNS change cannot bypass validation.
        lookup(hostname, options, callback) {
          dns.lookup(hostname, { all: true }, (error, addresses) => {
            if (
              error ||
              !addresses.length ||
              addresses.some(({ address }) => !isPublicAddress(address))
            ) {
              callback(
                new Error("Callback must resolve to a public address"),
                ""
              )
              return
            }
            const address = addresses[0]
            callback(
              null,
              options.all ? [address] : address.address,
              address.family
            )
          })
        },
      },
      (response) => {
        resolve(response.statusCode ?? 0)
        // Only the status matters; don't buffer an untrusted response body or follow redirects.
        response.destroy()
      }
    )
    request.on("error", () =>
      reject(new Error("Webhook request failed or timed out"))
    )
    request.end(body)
  })
}

export interface Config {
  nessieApiKey: string
  nessieBaseUrl: string
  platformAccountId: string
  publicBaseUrl: string
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    nessieApiKey: env.NESSIE_API_KEY ?? "",
    nessieBaseUrl: (
      env.NESSIE_BASE_URL || "https://api.nessieisreal.com"
    ).replace(/\/$/, ""),
    platformAccountId: env.PLATFORM_ACCOUNT_ID ?? "",
    publicBaseUrl: (env.PUBLIC_BASE_URL || "http://localhost:3000").replace(
      /\/$/,
      ""
    ),
  }
}

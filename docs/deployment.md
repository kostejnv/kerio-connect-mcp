# Deployment

The server runs as a Docker container behind a reverse proxy that terminates TLS. The examples use Caddy and a shared
Docker network; any proxy that forwards HTTPS to the container works.

## Requirements

- Docker with Compose
- A reverse proxy with a public HTTPS host name (for example `kerio.example.com`)
- Outbound HTTPS from the server to the Kerio Connect servers users will connect to

## First deployment

```bash
git clone https://github.com/kostejnv/kerio-connect-mcp.git /root/kerio-mcp
cd /root/kerio-mcp

cp .env.example .env
chmod 600 .env
openssl rand -base64 32   # put the output into MCP_TOKEN_KEY
# edit .env: PUBLIC_URL=https://kerio.example.com, KERIO_ALLOW_SEND=false

docker network create shared_net   # once, if it does not exist yet
docker compose up -d --build
```

The container publishes no ports. It joins the external network `shared_net`, where the proxy reaches it as
`kerio-mcp:3000`.

Caddy configuration:

```
kerio.example.com {
    reverse_proxy kerio-mcp:3000
}
```

Reload Caddy (for a Caddy container: `docker exec caddy caddy reload --config /etc/caddy/Caddyfile`).

## Checking the deployment

```bash
curl -I https://kerio.example.com/
# 200: the landing page (what the server does, how to connect, the tools)

curl https://kerio.example.com/healthz
# {"status":"ok"}

curl https://kerio.example.com/.well-known/oauth-authorization-server
# OAuth metadata with registration_endpoint, token_endpoint, ...

curl -i -X POST https://kerio.example.com/mcp
# 401 with a WWW-Authenticate header
```

Then connect a client (see [README](../README.md#connecting-a-client)).

## Configuration

`.env` (see `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `MCP_TRANSPORT` | `http` in Docker | Transport |
| `PUBLIC_URL` | — | Public https URL; used as OAuth issuer and MCP resource (`<PUBLIC_URL>/mcp`) |
| `PORT` | `3000` | Port inside the container |
| `MCP_TOKEN_KEY` | — | 32 random bytes, base64 |
| `KERIO_ALLOW_SEND` | `false` | `true` offers sending as a per-connection opt-in on the sign-in page |
| `KERIO_ALLOWED_SERVERS` | empty | Comma-separated Kerio host names users may connect to; empty = any public host |
| `KERIO_CA_FILE` | — | Path inside the container to a PEM company CA or self-signed Kerio certificate, e.g. `/app/certs/kerio.pem` (see below) |
| `KERIO_REQUEST_TIMEOUT_MS` | `30000` | Timeout for requests to Kerio |

Changes to `.env` take effect after `docker compose up -d`.

### Kerio servers with a company or self-signed certificate

Kerio Connect often uses its own self-signed certificate. Certificate verification stays on; instead, trust that specific
certificate (or the company CA that issued it). The `certs/` directory is mounted read-only at `/app/certs` and its
contents are not committed.

```bash
cd /root/kerio-mcp
# fetch the certificate the server presents
echo | openssl s_client -connect mail.example.com:443 -servername mail.example.com 2>/dev/null \
  | openssl x509 -outform PEM > certs/mail.example.com.pem
# compare this fingerprint with the one your IT department (or the browser) shows
openssl x509 -in certs/mail.example.com.pem -noout -fingerprint -sha256
echo 'KERIO_CA_FILE=/app/certs/mail.example.com.pem' >> .env
docker compose up -d
```

Fetching the certificate over the network trusts whatever is presented at that moment, so confirm the fingerprint through
an independent channel. Several certificates can be concatenated into one PEM file. When the Kerio certificate is
renewed, repeat the steps.

## Operations

| Task | Command |
|---|---|
| Update to the latest version | `git pull && docker compose up -d --build` |
| Logs | `docker logs -f kerio-mcp` |
| Restart | `docker compose restart` |
| Enable the sending option | set `KERIO_ALLOW_SEND=true`, then `docker compose up -d` |
| Disable sending for everyone | set `KERIO_ALLOW_SEND=false`, then `docker compose up -d`; applies immediately, also to connections that opted in earlier |
| Sign out every connection | replace `MCP_TOKEN_KEY` with a new random value, then `docker compose up -d` |
| Roll back | `git checkout <previous commit> && docker compose up -d --build` |
| Free disk space after updates | `docker image prune -f` |

A connection can send only while **both** hold: the user opted in at sign-in (sealed into its tokens) and the server has
`KERIO_ALLOW_SEND=true`. Re-enabling the master switch restores sending only for connections that opted in.

The container runs as the unprivileged `node` user with a read-only file system, no Linux capabilities and
`no-new-privileges`. A health check calls `/healthz` every 30 seconds.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Sign-in page says *Kerio server is not reachable* | Kerio is not reachable from the server (firewall, VPN-only, wrong host), or its certificate is not trusted (set `KERIO_CA_FILE`) |
| *must not be on a private or local network* | The Kerio host resolves to a private address; this is blocked on purpose |
| *not in the list of allowed servers* | Add the host to `KERIO_ALLOWED_SERVERS` |
| *Kerio sign-in failed* | Wrong username or password, or the account may not use the web client API |
| *This sign-in request has expired* | The sign-in page was open longer than 15 minutes; start connecting again from the client |
| Client keeps asking to sign in again | `MCP_TOKEN_KEY` changed, or the refresh token was unused for 90 days |
| Container exits at start | Configuration error; `docker logs kerio-mcp` names the invalid variable |
